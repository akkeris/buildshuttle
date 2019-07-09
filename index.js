const express = require("express");
const app = express();
const DockerOde = require("dockerode");
const docker = new DockerOde({socketPath: "/var/run/docker.sock"});
const http = require("http");
const https = require("https");
const url = require("url");
const dockerBuildImage = process.env.DOCKER_BUILD_IMAGE || "akkeris/buildshuttle:latest";
const builders = [];
const common = require("./common.js");
const fs = require("fs");
const dns = require("dns");
const utils = require("util");
const resolve = utils.promisify(dns.lookup);
const debug = require("debug")("buildshuttle");
const Logs = require("./logs.js");
const kube = require('./kube.js');

async function stopDockerBuild(container) {
  try {
    await container.stop({"t":0});
  } catch (e) {
    common.log("Stopping container on stop failed:", e.message);
  }
}

async function removeDockerBuild(container) {
  try {
    await container.remove({"v":true, "link":true, "force":true});
  } catch (e) {
    if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
      common.log("Removing container on stop failed:", e.message);
      try {
        await container.remove({"v":true, "link":true, "force":true});
      } catch (ee) {
        common.log("Removing container forcefully on stop failed:", ee.message);
      }
    }
  }
}

async function kubernetesLogsByPod(app, build_number) {
  return await kube.logs("buildshuttle-worker-" + app + "-" + build_number, "akkeris-system");
}
async function stopKubernetesBuildByPod(app, build_number) {
  common.log("Removing kubernetes pod,", "buildshuttle-worker-" + app + "-" + build_number, "in space akkeris-system")
  await kube.stop("buildshuttle-worker-" + app + "-" + build_number, "akkeris-system");
}

async function stopDockerBuildByName(containerName) {
  let containers = await docker.listContainers({all:true});
  await Promise.all(containers.map(async (containerInfo) => {
    if(containerInfo.Names.includes(`/${containerName}`) || containerInfo.Names.includes(containerName)) {
      try {
        common.log("Removing container,", containerInfo.Names.join(","));
        let c = docker.getContainer(containerInfo.Id);
        await stopDockerBuild(c);
        await removeDockerBuild(c);
        await c.wait({"condition":"removed"});
      } catch (e) {
        common.log(`Warning: Unable to remove container ${containerName}`);
      }
    }
  }));
}

async function runWorkerViaKubernetes(dockerBuildImage, logs, app, app_uuid, build_number, payload, callback, callback_auth) {
  debug("Build worker starting via kubernetes service account.");

  let env = process.env;
  env["PAYLOAD"] = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8").toString("base64");
  try {
    let res = await kube.run("buildshuttle-worker-" + app + "-" + build_number, "akkeris-system", "akkeris", dockerBuildImage, ["node", "worker.js"], env, logs)
    if(res.exitCode === 0) {
      common.log(`Build succeeded: ${app}-${app_uuid}-${build_number}`);
      await common.sendStatus(callback, callback_auth, build_number, "succeeded", false);
    } else {
      common.log(`Build failed: ${app}-${app_uuid}-${build_number} with exit code ${res.exitCode}`);
      await common.sendStatus(callback, callback_auth, build_number, "failed", false);
    }
    common.log(`Build finished (code: ${res ? res.exitCode : "unknown"}): ${app}-${app_uuid}-${build_number}`);
  } catch (e) {
    console.log(`Error during worker execution: ${e.message}\n${e.stack}`);
    common.log(`Build failed: ${app}-${app_uuid}-${build_number}`);
    await common.sendStatus(callback, callback_auth, build_number, "failed", false);
  }
}

function runWorkerViaDocker(dockerBuildImage, logs, app, app_uuid, build_number, payload, callback, callback_auth) {
  debug("Build worker starting via docker socket.");
  let Binds = [
    "/var/run/docker.sock:/run/docker.sock"
  ];
  if(process.env.TEST_MODE) {
    try { fs.mkdirSync("/tmp/archives"); } catch (e) { }
    Binds.push("/tmp/archives:/tmp/archives");
  }
  let cenv = Object.keys(process.env).map((x) => `${x}=${process.env[x]}`)
    .concat([`PAYLOAD=${Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8").toString("base64")}`]);
  let env = {
    name:`${app}-${app_uuid}-${build_number}`,
    Env:cenv,
    HostConfig:{
      Binds,
      Privileged:true,
      AutoRemove:true,
      Dns:dns.getServers(),
    },
  };
  return docker.run(dockerBuildImage, ["node", "worker.js"], logs, env, async (err, data, container) => {
    try {
      if (err) {
        return common.log(`Running worker returned with an error: ${err.message}\n${err.stack}`);
      }
      try {
        await container.remove({"v":true, "link":true, "force":true});
      } catch (e) {
        if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
          common.log("Removing after build finished failed:", e.message);
        }
      }
      if (data && data.StatusCode !== 0) {
        common.log(`Build failed: ${app}-${app_uuid}-${build_number}`);
        await common.sendStatus(callback, callback_auth, build_number, "failed", false);
      } else {
        common.log(`Build succeeded: ${app}-${app_uuid}-${build_number}`);
        await common.sendStatus(callback, callback_auth, build_number, "succeeded", false);
      }
      common.log(`Build finished (code: ${data ? data.StatusCode : "unknown"}): ${app}-${app_uuid}-${build_number}`);
    } catch (e) {
      console.error(`Error during build callback: ${e.message}\n${e.stack}`);
    }
  })
}

async function createBuild(req, res) {
  // TODO: more sanity checks on input.
  if (!req.body.sources || !req.body.app || !req.body.space || !req.body.app_uuid || !req.body.gm_registry_host || !req.body.gm_registry_repo || !req.body.build_number || !req.body.build_uuid) {
    return res.status(400).send({"status":"Bad Request - missing fields."});
  }
  if (!(/([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)/i).test(req.body.build_uuid)) {
    return res.status(400).send({"status":"Bad Request - build uuid is invalid."});
  }
  const logs = new Logs(req.body.kafka_hosts, req.body.app, req.body.app_uuid, req.body.space, req.body.build_uuid, req.body.build_number);
  await logs.open();
  debug("received request:", JSON.stringify(req.body));
  try {
    // if the container already exists, remove it.
    let containerName = `${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`;
    await stopDockerBuildByName(containerName);
    common.log(`Build starting: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
    await common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, "pending", false);

    if(process.env.USE_KUBERNETES == "true") {
      runWorkerViaKubernetes(dockerBuildImage, logs, req.body.app, req.body.app_uuid, req.body.build_number, req.body, req.body.callback, req.body.callback_auth)
        .then(() => {
          res.send({"status":"ok"});
        })
        .catch((e) => {
          res.status(500).send({"status":"Internal Server Error"});
          console.error(`Error in kubernetes execution on worker: ${e.message}\n${e.stack}`)
        })
    } else {
      runWorkerViaDocker(dockerBuildImage, logs, req.body.app, req.body.app_uuid, req.body.build_number, req.body, req.body.callback, req.body.callback_auth)
        .on("start", (container) => {
          res.send({"status":"ok"});
        });
    }
  } catch (e) {
    common.log(`Failed to submit build.\n${e}`);
    res.status(500).send({"status":"Internal Server Error"});
  }
}

async function getBuild(req, res) {
  try {
    if (!(/([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)/i).test(req.params.build)) {
      return res.status(400).send({"status":"Bad Request - build uuid is invalid."});
    }
    let stream = await common.getObject(req.params.build);
    stream.on("error", (err) => {
      common.log("Error getting build", err);
      res.status(404).send({"status":"Not Found"});
    });
    stream.pipe(res);
  } catch (e) {
    common.log("failed to get build:", e);
    res.status(404).send({"status":"Not Found"});
  }
}

async function buildExists(req, res) {
  try {
    if (!(/([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)/i).test(req.params.build)) {
      return res.status(400).send({"status":"Bad Request - build uuid is invalid."});
    }
    if(common.haveObject(req.params.build)) {
      res.status(200).end();
    } else {
      res.status(404).send({"status":"Not Found"});
    }
  } catch (e) {
    common.log(`Failed to see build exists: ${e.message}\n${e.stack}`);
    res.status(500).send({"status":"Internal Server Error"});
  }
}

async function stopBuild(req, res) {
  try {
    res.send({"status":"ok"});
    if(process.env.USE_KUBERNETES == "true") {
      await stopKubernetesBuildByPod(req.params.app_id.split('-')[0], req.params.number); // TODO: stop this insanity with app, app uuid, build number..
    } else {
      await stopDockerBuildByName(`${req.params.app_id}-${req.params.number}`);
    }
  } catch (e) {
    common.log(`Failed to stop build: ${e.message}\n${e.stack}`);
    res.status(500).send({"status":"Internal Server Error"});
  }
}

async function getBuildLogs(req, res) {
  try {
    // TODO: validate this input.
    debug(`fetching ${req.params.app_id}-${req.params.number}.logs`);
    if(process.env.TEST_MODE == "true" && process.env.USE_KUBERNETES == "true") {
      let logline = await kubernetesLogsByPod(req.params.app_id.split('-')[0], req.params.number);
      res.status(200).send(logline || "")
      return
    }
    let stream = await common.getObject(`${req.params.app_id}-${req.params.number}.logs`);
    stream.on("error", (err) => {
      if(err.message && err.message.indexOf("no such file") === -1) {
        common.log("Error fetching build logs", err);
      }
      res.status(404).send({"status":"Not Found"});
    });
    stream.pipe(res);
  } catch (e) {
    common.log("failed to get build logs:", e);
    res.status(404).send({"status":"Not Found"});
  }
}

app.use(require("body-parser").json());
app.get("/octhc", (res) => res.send("overall_status=good"));
app.post("/", createBuild);
app.head("/:build", buildExists);
app.get("/:build", getBuild);
app.delete("/:build", (req, res) => res.status(200).send({"status":"ok"}));
app.delete("/:app_id/:number", stopBuild);
app.get("/:app_id/:number/logs", getBuildLogs);

app.listen(process.env.PORT || 9000);
