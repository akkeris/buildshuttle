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

async function stopDockerBuild(container) {
  try {
    await container.stop({"t":0});
  } catch (e) {
    common.log("Stopping container on stop failed:", e.message);
  }
  try {
    await container.remove();
  } catch (e) {
    if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
      common.log("Removing container on stop failed:", e.message);
      try {
        await container.remove({"force":true});
      } catch (ee) {
        common.log("Removing container forcefully on stop failed:", ee.message);
      }
    }
  }
}

async function stopDockerBuildByName(containerName) {
  let containers = await docker.listContainers({all:true});
  await Promise.all(containers.map(async (containerInfo) => {
    if(containerInfo.Names.includes(`/${containerName}`) || containerInfo.Names.includes(containerName)) {
      try {
        common.log("Removing container,", containerInfo.Names.join(","));
        let c = docker.getContainer(containerInfo.Id);
        await stopDockerBuild(c);
        await c.wait({"condition":"removed"});
      } catch (e) {
        common.log(`Warning: Unable to remove container ${containerName}`);
      }
    }
  }));
}

async function createBuild(req, res) {
  if (!req.body.sources || !req.body.app || !req.body.space || !req.body.app_uuid || !req.body.gm_registry_host || !req.body.gm_registry_repo || !req.body.build_number || !req.body.build_uuid) {
    return res.status(400).send({"status":"Bad Request - missing fields."});
  }
  if (!(/([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)/i).test(req.body.build_uuid)) {
    return res.status(400).send({"status":"Bad Request - build uuid is invalid."})
  }
  let Binds = ["/var/run/docker.sock:/run/docker.sock"];
  if(process.env.TEST_MODE) {
    try { fs.mkdirSync("/tmp/archives"); } catch (e) { }
    Binds.push("/tmp/archives:/tmp/archives");
  }
  let cenv = Object.keys(process.env).map((x) => `${x}=${process.env[x]}`)
    .concat([`PAYLOAD=${Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body), "utf8").toString("base64")}`]);

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
    let containerName = `${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`;
    await stopDockerBuildByName(containerName);
    let timeout = null;
    common.log(`Build starting: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
    common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, "pending", false);
    docker.run(dockerBuildImage, ["node", "worker.js"], process.stdout, env, async (err, data, container) => {
      clearInterval(timeout);
      timeout = null;
      if (err) {
        return common.log(`Running worker returned with an error: ${err.message}\n${err.stack}`);
      }
      try {
        await container.remove();
      } catch (e) {
        if(!e.message.includes("is already in progress") && !e.message.includes("no such container")) {
          common.log("Removing after build finished failed:", e.message);
        }
      }
      if (data && data.StatusCode !== 0) {
        common.log(`Build failed: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
        common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, "failed", false);
      } else {
        common.log(`Build succeeded: ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
        common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, "succeeded", false);
      }
      common.log(`Build finished (code: ${data ? data.StatusCode : "unknown"}): ${req.body.app}-${req.body.app_uuid}-${req.body.build_number}`);
    }).on("start", (container) => {
      res.send({"status":"ok"});
      timeout = setTimeout(() => {
        if (timeout) {
          stopDockerBuild(container);
          common.sendStatus(req.body.callback, req.body.callback_auth, req.body.build_number, "failed", false);
        }
      }, 20 * 60 * 1000); // 20 minute timeout
    });
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
    res.status(500).send({"status":"Internal Server Error"})
  }
}

async function stopBuild(req, res) {
  try {
    res.send({"status":"ok"});
    await stopDockerBuildByName(`${req.params.app_id}-${req.params.number}`);
  } catch (e) {
    common.log(`Failed to stop build: ${e.message}\n${e.stack}`);
    res.status(500).send({"status":"Internal Server Error"});
  }
}

async function getBuildLogs(req, res) {
  try {
    // TODO: validate this input.
    let stream = await common.getObject(`${req.params.app_id}-${req.params.number}.logs`);
    stream.on("error", (err) => {
      common.log("Error fetching build logs", err);
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
