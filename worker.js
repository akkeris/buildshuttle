const url = require("url");
const DockerOde = require("dockerode");
const docker = new DockerOde({socketPath: "/var/run/docker.sock"});
const common = require("./common.js");
const http = require("http");
const https = require("https");
const { execSync } = require("child_process");
const fs = require("fs");
const logs = require('./logs.js');

function calcBuildArgs(buildArgs) {
  if (process.env.EXTRA_BUILD_ARGS) {
    buildArgs = Object.assign(JSON.parse(process.env.EXTRA_BUILD_ARGS), buildArgs);
  }
  // Ensure the user cannot submit any obnoxious key values that might corrupt the build.
  let newBuildArgs = {};
  Object.keys(buildArgs).forEach((x) => {
    newBuildArgs[x.replace(/([^A-Za-z0-9_]+)/g, "")] = buildArgs[x];
  });
  return newBuildArgs;
}

function calcDockerFile(newBuildArgs, filePath) {
  let newDockerFile = [];
  fs.readFileSync(filePath).toString("utf8").split("\n").map((line) => {
    newDockerFile.push(line);
    if(line.startsWith("FROM ")) {
      newDockerFile = newDockerFile.concat(Object.keys(newBuildArgs).map((x) => `ARG ${x}`));
    }
  });
  return newDockerFile.join("\n");
}

function follow(stream, onProgress) {
  return new Promise((resolve, reject) => docker.modem.followProgress(stream, (err, output) => err ? reject(err) : resolve(output), onProgress));
}

async function build(payload) {
  if(process.env.DEBUG) {
    console.log('[debug-worker]: beginning general build task...')
  }
  try {
    await logs.open(payload);
    if(process.env.DEBUG) {
      console.log('[debug-worker]: logs opened...')
    }
    await logs.send(payload, "build", 
      {"status":execSync("tar zxf /tmp/sources -C /tmp/build || unzip /tmp/sources -d /tmp/build", {cwd:"/tmp", stdio:["pipe", "pipe", "pipe"]})});
    // Unzip will put a single directory with the original folder name inside of /tmp/build, for example
    // if the original zip was a folder "foobar" then a new folder /tmp/build/foobar will be unzipped, this
    // will remove all the contents backc to /tmp/build.
    await logs.send(payload, "build",
      {"status":execSync("if [ `ls -d */ | wc -l` = \"1\" ]; then if [ `ls . | wc -l` = \"1\" ]; then mv */.[!.]* . || true; mv */* . || true; fi fi", {cwd:"/tmp/build", stdio:["pipe", "pipe", "pipe"]})});
    if(process.env.DEBUG) {
      console.log('[debug-worker]: extracted sources...')
    }
    let newBuildArgs = calcBuildArgs(payload.build_args || {});
    fs.writeFileSync("/tmp/build/Dockerfile", calcDockerFile(newBuildArgs, "/tmp/build/Dockerfile"));
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `0.${payload.build_number}`;
    let build_options = { 
      "buildargs":newBuildArgs, 
      "t":`${repo}:${tag}`,
      "labels":{
        "app":payload.app,
        "space":payload.space,
        "build_uuid":payload.build_uuid,
        "app_uuid":payload.app_uuid,
      },
      "cpuperiod":100000, 
      "cpuquota":50000,    // 50000/100000 or (1/2 cpu)
      "memory":1073741824, // 1 gigabyte memory
    };
    build_options.nocache = (process.env.TEST_MODE || process.env.NO_CACHE === "true") ? true : false;
    if(process.env.DEBUG) {
      console.log('[debug-worker]: beginning putting sources and building docker image...')
    }
    let buildStream = await docker.buildImage({"context":"/tmp/build"}, build_options);
    if(process.env.DEBUG) {
      console.log('[debug-worker]: build stream started')
    }
    await Promise.all([
      common.putObject(payload.build_uuid, fs.createReadStream("/tmp/sources")),
      follow(buildStream, logs.send.bind(null, payload, "build"))
    ])
    if(process.env.DEBUG) {
      console.log('[debug-worker]: getting image and pushing it to gm_registry_auth...')
    }
    await follow(await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    if(process.env.DEBUG) {
      console.log('[debug-worker]: finished pushing image...')
    }
    await logs.close(payload);
    process.exit(0);
  } catch (e) {
    if(e.message) {
      common.log(`Error during build (docker build process): ${e.message}\n${e.stack}`);
    } else {
      common.log(`Error during build (docker build process): ${e}`);
    }
    process.exit(127);
  }
}

async function buildFromDocker(payload) {
  if(process.env.DEBUG) {
    console.log('[debug-worker]: building payload from docker')
  }
  try {
    await logs.open(payload);
    let parsedUrl = url.parse(payload.sources);
    let pullAuth = {};
    if ( parsedUrl.auth ) {
      pullAuth = {"username":parsedUrl.auth.split(":")[0], "password":parsedUrl.auth.split(":")[1]};
    }
    if (payload.docker_login) {
      pullAuth = {"username":payload.docker_login, "password":payload.docker_password};
    }
    await follow(await docker.pull(payload.sources.replace("docker://", ""), {}, undefined, pullAuth), 
      logs.send.bind(null, payload, "pull"));
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `0.${payload.build_number}`;
    await (docker.getImage(payload.sources.replace("docker://", ""))).tag({repo, tag});
    await (docker.getImage(payload.sources.replace("docker://", ""))).tag({repo, tag:"latest"});
    await follow(
      await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    await follow(
      await (docker.getImage(`${repo}:latest`)).push({tag:"latest"}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    await logs.close(payload);
    process.exit(0);
  } catch (e) {
    common.log(`Error during build (from docker): ${e.message}\n${e.stack}`);
    await logs.close(payload);
    process.exit(1);
  }
}

async function buildFromStream(payload, stream) {
  if(process.env.DEBUG) {
    console.log('[debug-worker]: building payload from stream')
  }
  let dest = fs.createWriteStream("/tmp/sources");
  dest.on("close", () => build(payload));
  dest.on("error", (e) => {
    common.log(`Error during build (attempting to stream to sources): ${e.message}\n${e.stack}`);
    process.exit(127);
  })
  stream.pipe(dest);
  stream.on("error", (e) => {
    common.log(`Error during build (attempting to stream from http): ${e.message}\n${e.stack}`);
    process.exit(127);
  });
}

async function buildFromBuffer(payload, buffer) {
  if(process.env.DEBUG) {
    console.log('[debug-worker]: building payload from buffer')
  }
  fs.writeFileSync("/tmp/sources", buffer);
  build(payload);
}

async function execute() {
  let payload = JSON.parse(Buffer.from(process.env.PAYLOAD, "base64"));
  try {
    let parsedUrl = url.parse(payload.sources);
    if ( parsedUrl.protocol.toLowerCase() === "docker:" ) {
      buildFromDocker(payload);
    } else if ( parsedUrl.protocol === "data:" ) {
      let data = parsedUrl.pathname;
      while ( data[0] === "/" ||  data[0] === "," ) {
        data = data.substring(1);
      }
      if ( parsedUrl.host === "base64" ) {
        data = Buffer.from(data, "base64");
      }
      buildFromBuffer(payload, data);
    } else if ( parsedUrl.protocol.startsWith("http")) {
      let connector = (parsedUrl.protocol === "https:" ? https : http);
      connector.get(payload.sources, (res) => {
        if((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return connector.get(res.headers.location, buildFromStream.bind(null, payload));
        }
        buildFromStream(payload);
      }).on("error", (e) => {
        common.log(`Error during build (fetching streams): ${e.message}\n${e.stack}`);
        process.exit(127);
      });
    }
  } catch (e) {
    common.log(`Error during build: ${e.message}\n${e.stack}`);
    process.exit(127);
  }
}

if(process.env.DEBUG) {
  console.log(`[debug-worker]: beginning processing... `)
}

execute().catch((err) => {
  console.log(err);
  process.exit(127);
});
