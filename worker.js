const url = require("url");
const DockerOde = require("dockerode");
const docker = new DockerOde(process.env.DOCKER_BUILD_SETTINGS ? JSON.parse(process.env.DOCKER_BUILD_SETTINGS) : {socketPath: "/var/run/docker.sock"});
const common = require("./common.js");
const http = require("http");
const https = require("https");
const { execSync } = require("child_process");
const fs = require("fs");
const logs = require('./logs.js');
const debug = require('debug')('buildshuttle-worker');

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
  debug(`beginning general build task ${payload.build_uuid}`);
  try {
    await logs.open(payload);
    debug('logs opened');
    console.time(`build.extracting sources ${payload.build_uuid}`);
    await logs.send(payload, "build", 
      {"status":execSync("tar zxf /tmp/sources -C /tmp/build || unzip /tmp/sources -d /tmp/build", {cwd:"/tmp", stdio:["pipe", "pipe", "pipe"]})});
    // Unzip will put a single directory with the original folder name inside of /tmp/build, for example
    // if the original zip was a folder "foobar" then a new folder /tmp/build/foobar will be unzipped, this
    // will remove all the contents backc to /tmp/build.
    await logs.send(payload, "build",
      {"status":execSync("if [ `ls -d */ | wc -l` = \"1\" ]; then if [ `ls . | wc -l` = \"1\" ]; then mv */.[!.]* . || true; mv */* . || true; fi fi", {cwd:"/tmp/build", stdio:["pipe", "pipe", "pipe"]})});
    debug('extracted sources');
    let newBuildArgs = calcBuildArgs(payload.build_args || {});
    fs.writeFileSync("/tmp/build/Dockerfile", calcDockerFile(newBuildArgs, "/tmp/build/Dockerfile"));
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `1.${payload.build_number}`;
    let build_options = { 
      "buildargs":newBuildArgs, 
      "t":`${repo}:${tag}`,
      "labels":{
        "app":payload.app,
        "space":payload.space,
        "build_uuid":payload.build_uuid,
        "app_uuid":payload.app_uuid,
      },
    };
    console.timeEnd(`build.extracting sources ${payload.build_uuid}`);
    if(payload.gm_registry_auth) {
      build_options.registryconfig = {};
      build_options.registryconfig[payload.gm_registry_host] = payload.gm_registry_auth;
      let auth = JSON.parse(JSON.stringify(payload.gm_registry_auth));
      if(!auth.serveraddress) {
        auth.serveraddress = payload.gm_registry_host;
      }
      debug(`attempting to authorize ${auth.serveraddress} with ${auth.username}`);
      console.time(`build.auth`);
      try {
        await docker.checkAuth(auth);
      } catch (e) {
        common.log(`Error, unable to authorize ${auth.serveraddress}: ${e.message}\n${e.stack}`);
      }
      console.timeEnd(`build.auth`);
      if(!auth.serveraddress.startsWith('https://')) {
        console.time(`build.auth(https)`);
        auth.serveraddress = `https://${auth.serveraddress}`;
        try {
          await docker.checkAuth(auth);
        } catch (e) {
          common.log(`Error, unable to authorize ${auth.serveraddress}: ${e.message}\n${e.stack}`);
        }
        console.timeEnd(`build.auth(https)`);
      }
    }

    build_options.nocache = (process.env.TEST_MODE || process.env.NO_CACHE === "true") ? true : false;
    debug('starting build');
    console.time(`build.start ${payload.build_uuid}`);
    let buildStream = await docker.buildImage({"context":"/tmp/build"}, build_options);
    console.timeEnd(`build.start ${payload.build_uuid}`);
    debug('started build');
    console.time(`build.uploading sources ${payload.build_uuid}`);
    await common.putObject(payload.build_uuid, fs.createReadStream("/tmp/sources"));
    console.timeEnd(`build.uploading sources ${payload.build_uuid}`);
    console.time(`build.building ${payload.build_uuid}`);
    await follow(buildStream, logs.send.bind(null, payload, "build"));
    console.timeEnd(`build.building ${payload.build_uuid}`);
    await Promise.all([
      (async () => {
      })(),
      (async () => {
      })()
    ]);
    debug(`pushing image ${repo}:${tag}`);
    console.time(`build.pushing ${repo}:${tag}`);
    await follow(await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    debug(`pushed image ${repo}:${tag}`);
    console.timeEnd(`build.pushing ${repo}:${tag}`);
    console.time("logs.close");
    await logs.close(payload);
    console.timeEnd("logs.close");
    process.exit(0);
  } catch (e) {
    console.time("logs.close");
    await logs.close(payload);
    console.timeEnd("logs.close");
    if(e.message) {
      common.log(`Error during build (docker build process): ${e.message}\n${e.stack}`);
    } else {
      common.log(`Error during build (docker build process): ${e}`);
    }
    process.exit(127);
  }
}

async function buildFromDocker(payload) {
  debug('build pulling and pushing existing image');
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
    
    debug(`pulling image ${payload.sources.replace("docker://", "")}`);
    console.time(`buildFromDocker.pulling image ${payload.sources.replace("docker://", "")}`);
    await follow(await docker.pull(payload.sources.replace("docker://", ""), {}, undefined, pullAuth), 
      logs.send.bind(null, payload, "pull"));
    console.timeEnd(`buildFromDocker.pulling image ${payload.sources.replace("docker://", "")}`);
    debug(`pulled image ${payload.sources.replace("docker://", "")}`);
    
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `1.${payload.build_number}`;
    debug(`tagging image ${payload.sources.replace("docker://", "")}`);
    console.time(`buildFromDocker.tagging image ${payload.sources.replace("docker://", "")} with ${repo}:${tag}`);
    await (docker.getImage(payload.sources.replace("docker://", ""))).tag({repo, tag});
    await (docker.getImage(payload.sources.replace("docker://", ""))).tag({repo, tag:"latest"});
    console.timeEnd(`buildFromDocker.tagging image ${payload.sources.replace("docker://", "")} with ${repo}:${tag}`);
    debug(`tagged image ${payload.sources.replace("docker://", "")}`);
    debug(`pushing image ${repo}:${tag}`);

    console.time(`buildFromDocker.pushing image ${payload.sources.replace("docker://", "")}`);
    await follow(
      await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    console.timeEnd(`buildFromDocker.pushing image ${payload.sources.replace("docker://", "")}`);
    debug(`pushed image ${repo}:${tag}`);
    debug(`pushing image ${repo}:latest`);
    console.time(`buildFromDocker.pushing image (latest) ${payload.sources.replace("docker://", "")}`);
    await follow(
      await (docker.getImage(`${repo}:latest`)).push({tag:"latest"}, undefined, payload.gm_registry_auth), 
      logs.send.bind(null, payload, "push"));
    console.timeEnd(`buildFromDocker.pushing image (latest) ${payload.sources.replace("docker://", "")}`);
    debug(`pushed image ${repo}:latest`);
    console.time(`logs.close`);
    await logs.close(payload);
    console.timeEnd(`logs.close`);
    process.exit(0);
  } catch (e) {
    common.log(`Error during build (from docker): ${e.message}\n${e.stack}`);
    await logs.close(payload);
    process.exit(1);
  }
}

async function buildFromStream(payload, stream) {
  debug('downloading sources from stream');
  console.time(`buildFromStream.downloading sources for ${payload.build_uuid}`);
  let dest = fs.createWriteStream("/tmp/sources");
  dest.on("close", () => {
    debug('downloaded sources from stream');
    console.timeEnd(`buildFromStream.downloading sources for ${payload.build_uuid}`);
    build(payload)
  });
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
  debug('fetching payload from buffer (data uri)');
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
        } else if (res.statusCode > 199 || res.statusCode < 300) {
          buildFromStream(payload, res);
        } else if (res) {
          common.log(`Error from build (fetching stream returned invalid code ${res.statuCode} ${res.status}).`);
          process.exit(127);
        } else {
          common.log(`No response was returned.`);
          process.exit(127);
        }
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

debug(`worker started`);

execute().catch((err) => {
  console.log(err);
  process.exit(127);
});
