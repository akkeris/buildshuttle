'use strict'
const express = require('express');
const app = express();
const dockerode = require('dockerode');
const docker = new dockerode({socketPath: '/var/run/docker.sock'});
const http = require('http');
const https = require('https');
const url = require('url');
const dockerBuildImage = process.env.DOCKER_BUILD_IMAGE || 'buildshuttle:test-3';
const builders = [];
const common = require('./common.js');


let containers = {};

async function createBuild(req, res) {
  if (!req.body.sources || !req.body.app || !req.body.space || !req.body.app_uuid || !req.body.gm_registry_host || !req.body.gm_registry_repo || !req.body.build_number || !req.body.build_uuid) {
    return res.status(400).send({"status":"Bad Request"});
  }
  let cenv = Object.keys(process.env).map((x) => `${x}=${process.env[x]}`)
    .concat([`PAYLOAD=${Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8').toString('base64')}`])
  let env = {
    Env:cenv,
    HostConfig:{
      Binds:["/var/run/docker.sock:/run/docker.sock"],
      Privileged:true,
    },
  };
  let timeout = null
  docker.run(dockerBuildImage, ['node', 'worker.js'], process.stdout, env, (err, data, container) => {
    clearInterval(timeout)
    timeout = null
    containers[req.params.build + req.body.build_number] = null;
    if (err) {
      return console.error(err)
    }
    container.remove()
  }).on('container', (container) => {
    container.callback_url = req.body.callback_url;
    container.callback_auth = req.body.callback_auth;
    containers[req.body.app_uuid + req.body.build_number] = container;
    timeout = setTimeout(() => {
      if ( timeout ) {
        container.stop();
        container.remove();
        containers[req.body.app_uuid + req.body.build_number] = null;
        common.sendStatus(container.callback_url, container.callback_auth, req.body.build_number, 'timeout', false);
      }
    }, 20 * 60 * 1000) // 20 minute timeout
  })
  res.send({"status":"ok"})
}

async function getBuild(req, res) {
  try {
    (await common.getObject(req.params.build)).pipe(res)
  } catch (e) {
    console.log('failed to get build:', e)
    res.sendStatus(404).send({"status":"Not Found"});
  }
}

async function buildExists(req, res) {
  if(common.haveObject(req.params.build)) {
    res.sendStatus(200).end();
  } else {
    res.sendStatus(404).send({"status":"Not Found"});
  }
}

async function stopBuild(req, res) {
  if (containers[req.params.build + req.params.number]) {
    containers[req.params.build + req.params.number].stop();
    containers[req.params.build + req.params.number].remove();
    let callbackUrl = containers[req.params.build + req.params.number].callback_url;
    let callbackAuth = containers[req.params.build + req.params.number].callback_auth;
    containers[req.params.build + req.params.number] = null;
    common.sendStatus(callbackUrl, callbackAuth, req.params.number, 'stopped', false);
  }
}

async function getBuildLogs(req, res) {
  try {
    res.send(common.getObject(`${req.params.build}.logs`))
  } catch (e) {
    console.log('failed to get build logs:', e)
    res.sendStatus(404).send({"status":"Not Found"})
  }
}

app.use(require('body-parser').json());
app.get('/octhc', (res) => res.send('overall_status=good'));
app.post('/', createBuild);
app.head('/:build', buildExists);
app.get('/:build', getBuild);
app.delete('/:build', (req, res) => res.sendStatus(200).send({"status":"ok"}));
app.delete('/:build/:number', stopBuild);
app.get('/:build/:number/logs', getBuildLogs);

app.listen(process.env.PORT || 9000);
