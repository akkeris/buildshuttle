const url = require('url');
const dockerode = require('dockerode');
const docker = new dockerode({socketPath: '/var/run/docker.sock'});
const common = require('./common.js');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');

async function build(payload) {
  try {
    payload.build_args = payload.build_args || {}
    common.sendLogs(payload, 'build', 
      {"status":execSync('tar zxf /tmp/sources -C /tmp/build || unzip /tmp/sources -d /tmp/build', {cwd:'/tmp', stdio:['pipe', 'pipe', 'pipe']})});
    // Unzip will put a single directory with the original folder name inside of /tmp/build, for example
    // if the original zip was a folder "foobar" then a new folder /tmp/build/foobar will be unzipped, this
    // will remove all the contents backc to /tmp/build.
    common.sendLogs(payload, 'build',
      {"status":execSync('if [ `ls -d */ | wc -l` = \"1\" ]; then if [ `ls . | wc -l` = \"1\" ]; then mv */.[!.]* . || true; mv */* . || true; fi fi', {cwd:'/tmp/build', stdio:['pipe', 'pipe', 'pipe']})});
    if (process.env.EXTRA_BUILD_ARGS) {
      payload.build_args = Object.assign(JSON.parse(process.env.EXTRA_BUILD_ARGS), payload.build_args);
    }
    // Ensure the user cannot submit any obnoxious key values that might corrupt the build.
    let new_build_args = {};
    Object.keys(payload.build_args).forEach((x) => {
      new_build_args[x.replace(/([^A-Za-z0-9_]+)/g, '')] = payload.build_args[x]
    })
    
    let dockerFile = fs.readFileSync('/tmp/build/Dockerfile').toString('utf8');
    let newDockerFile = []
    dockerFile.split('\n').map((line) => {
      newDockerFile.push(line)
      if(line.startsWith('FROM ')) {
        newDockerFile = newDockerFile.concat(Object.keys(new_build_args).map((x) => `ARG ${x}`))
      }
    })
    fs.writeFileSync('/tmp/build/Dockerfile', newDockerFile.join('\n'))
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `0.${payload.build_number}`;
    
    let build_options = { buildargs:new_build_args, t:`${repo}:${tag}` }
    if (process.env.TEST_MODE || process.env.NO_CACHE) {
      build_options.nocache = true;
    }
    await Promise.all([
      common.putObject(payload.build_uuid, fs.createReadStream('/tmp/sources')),
      common.follow(await (docker.buildImage({'context':'/tmp/build'}, build_options)),
        common.sendLogs.bind(null, payload, 'build'))
    ]);
    await common.follow(await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      common.sendLogs.bind(null, payload, 'push'));
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'succeeded', true);
    common.closeLogs(payload);
  } catch (e) {
    console.error(`    - Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}\n${e.message}\n${e.stack}\n`)
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'failed', false);
    common.closeLogs(payload);
  }
}

async function buildFromDocker(payload) {
  let parsedUrl = new url.parse(payload.sources);
  let pullAuth = {}
  if ( parsedUrl.auth ) {
    pullAuth = {"username":parsedUrl.auth.split(':')[0], "password":parsedUrl.auth.split(':')[1]}
  }
  if (payload.docker_login) {
    pullAuth = {"username":payload.docker_login, "password":payload.docker_password}
  }
  await common.follow(await docker.pull(payload.sources.replace('docker://', ''), {}, undefined, pullAuth), 
    common.sendLogs.bind(null, payload, 'pull'));
  let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
  let tag = `0.${payload.build_number}`;
  await (docker.getImage(payload.sources.replace('docker://', ''))).tag({repo, tag});
  await (docker.getImage(payload.sources.replace('docker://', ''))).tag({repo, tag:'latest'});
  await common.follow(
    await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
    common.sendLogs.bind(null, payload, 'push'));
  await common.follow(
    await (docker.getImage(`${repo}:latest`)).push({tag:'latest'}, undefined, payload.gm_registry_auth), 
    common.sendLogs.bind(null, payload, 'push'));
  common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'succeeded', true);
  console.log(`    - Build succeeded for ${payload.app} ${payload.app_uuid} ${payload.build_number}`)
  common.closeLogs(payload);
}

async function buildFromStream(payload, stream) {
  let dest = fs.createWriteStream('/tmp/sources');
  dest.on('close', () => build(payload));
  stream.pipe(dest);
  stream.on('error', (err) => {
    console.error(`    - Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}. Failed to fetch stream.\n${err}`)
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'failed', false);
    common.closeLogs(payload);
  })
}

async function buildFromBuffer(payload, buffer) {
  fs.writeFileSync('/tmp/sources', buffer);
  build(payload);
}

async function execute() {
  let payload = JSON.parse(Buffer.from(process.env.PAYLOAD, 'base64'))
  try {
    let parsedUrl = new url.parse(payload.sources);
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'pending', false);
    if ( parsedUrl.protocol.toLowerCase() === "docker:" ) {
      buildFromDocker(payload);
    } else if ( parsedUrl.protocol === "data:" ) {
      let data = parsedUrl.pathname;
      while ( data[0] === '/' ||  data[0] === ',' ) {
        data = data.substring(1);
      }
      if ( parsedUrl.host === "base64" ) {
        data = Buffer.from(data, 'base64');
      }
      buildFromBuffer(payload, data);
    } else if ( parsedUrl.protocol.startsWith("http")) {
      let connector = (parsedUrl.protocol === 'https:' ? https : http);
      connector.get(payload.sources, (res) => {
        if((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return connector.get(res.headers.location, buildFromStream.bind(null, payload));
        }
        buildFromStream(payload);
      });
    }
  } catch (e) {
    console.error(`    - Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}\n${e}`)
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'failed', false);
    common.closeLogs(payload);
  }
}

execute().catch((err) => console.error(err))
