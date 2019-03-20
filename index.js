const express = require('express');
const app = express();
const dockerode = require('dockerode');
const docker = new dockerode({socketPath: '/var/run/docker.sock'});
const http = require('http');
const https = require('https');
const url = require('url');
const dockerBuildImage = process.env.DOCKER_BUILD_IMAGE || 'akkeris/buildshuttle:latest';
const builders = [];
const common = require('./common.js');

async function stopDockerBuild(container) {
  try {
    await container.stop({"t":0});
  } catch (e) {
    console.log('    - Stopping container on stop failed:', e.message)
  }
  try {
    await container.remove();
  } catch (e) {
    if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
      console.log('    - Removing container on stop failed:', e.message)
      try {
        await container.remove({"force":true});
      } catch (ee) {
        console.log('    - Removing container forcefully on stop failed:', ee.message)
      }
    }
  }
}

async function createBuild(req, res) {
  if (!req.body.sources || !req.body.app || !req.body.space || !req.body.app_uuid || !req.body.gm_registry_host || !req.body.gm_registry_repo || !req.body.build_number || !req.body.build_uuid) {
    return res.status(400).send({"status":"Bad Request"});
  }
  // DO NOT MOUNT /var/lib/docker, despite what some sites may say
  // see: https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/
  // see: https://applatix.com/case-docker-docker-kubernetes-part/
  // see: https://applatix.com/case-docker-docker-kubernetes-part-2/
  let Binds = ["/var/run/docker.sock:/run/docker.sock"];
  if(process.env.TEST_MODE) {
    try { fs.mkdirSync("/tmp/archives"); } catch (e) { }
    Binds.push("/tmp/archives:/tmp/archives");
  }
  let cenv = Object.keys(process.env).map((x) => `${x}=${process.env[x]}`)
    .concat([`PAYLOAD=${Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8').toString('base64')}`])

  let env = {
    name:`${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`,
    Env:cenv,
    HostConfig:{
      Binds,
      Privileged:true,
      AutoRemove:true,
    },
  };

  try {
    // if the container already exists, remove it.
    let containers = await docker.listContainers({all:true});
    await Promise.all(containers.map(async (containerInfo) => {
      if(containerInfo.Names.includes(`/${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`) || containerInfo.Names.includes(`${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`)) {
        try {
          console.warn('    - removing stale container,', containerInfo.Names.join(','));
          let c = docker.getContainer(containerInfo.Id);
          await stopDockerBuild(c);
          await c.wait({"condition":"removed"});
        } catch (e) {
          console.warn(`    - Warning: Unable to remove container ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
        }
      }
    }))
    let timeout = null;
    console.log(`    - Build starting: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
    docker.run(dockerBuildImage, ['node', 'worker.js'], process.stdout, env, async (err, data, container) => {
      clearInterval(timeout);
      timeout = null;
      if (err) {
        console.error('Running worker returned with an error:');
        return console.error(err);
      }
      try {
        await container.remove();
      } catch (e) {
        if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
          console.log('Removing after build finished failed:', e.message);
        }
      }
      if (data && data.StatusCode !== 0) {
        common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, 'failed', false);
      }
      console.log(`    - Build finished: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
    }).on('start', (container) => {
      res.send({"status":"ok"});
      timeout = setTimeout(() => {
        if (timeout) {
          stopDockerBuild(container);
          common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, 'failed', false);
        }
      }, 20 * 60 * 1000); // 20 minute timeout
    })
  } catch (e) {
    console.error(`Failed to submit build.\n${e}`);
    res.status(500).send({"status":"Internal Server Error"});
  }
}

async function getBuild(req, res) {
  try {
    let stream = await common.getObject(req.params.build)
    stream.on('error', (err) => {
      console.log('Error getting build', err);
      res.status(404).send({"status":"Not Found"});
    });
    stream.pipe(res);
  } catch (e) {
    console.error('failed to get build:', e);
    res.status(404).send({"status":"Not Found"});
  }
}

async function buildExists(req, res) {
  if(common.haveObject(req.params.build)) {
    res.status(200).end();
  } else {
    res.status(404).send({"status":"Not Found"});
  }
}

async function stopBuild(req, res) {
  res.send({"status":"ok"})
  let containers = await docker.listContainers({'all':true})
  containers.forEach(async (containerInfo) => {
    if(containerInfo.Names.includes(`/${req.params.app_id}-${req.params.number}`) || containerInfo.Names.includes(`${req.params.app_id}-${req.params.number}`)) {
      let container = docker.getContainer(containerInfo.Id);
      await stopDockerBuild(container)
    }
  })
}

async function getBuildLogs(req, res) {
  try {
    let stream = await common.getObject(`${req.params.app_id}-${req.params.number}.logs`)
    stream.on('error', (err) => {
      console.log('Error fetching build logs', err);
      res.status(404).send({"status":"Not Found"});
    });
    stream.pipe(res);
  } catch (e) {
    console.error('failed to get build logs:', e);
    res.status(404).send({"status":"Not Found"});
  }
}

app.use(require('body-parser').json());
app.get('/octhc', (res) => res.send('overall_status=good'));
app.post('/', createBuild);
app.head('/:build', buildExists);
app.get('/:build', getBuild);
app.delete('/:build', (req, res) => res.status(200).send({"status":"ok"}));
app.delete('/:app_id/:number', stopBuild);
app.get('/:app_id/:number/logs', getBuildLogs);

app.listen(process.env.PORT || 9000);
