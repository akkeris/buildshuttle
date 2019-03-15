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
    execSync('tar zxf /tmp/sources -C /tmp/build || unzip /tmp/sources -d /tmp/build', {cwd:'/tmp'});
    // Unzip will put a single directory with the original folder name inside of /tmp/build, for example
    // if the original zip was a folder "foobar" then a new folder /tmp/build/foobar will be unzipped, this
    // will remove all the contents backc to /tmp/build.
    execSync('if [ `ls -d */ | wc -l` = \"1\" ]; then if [ `ls . | wc -l` = \"1\" ]; then mv */.[!.]* . || true; mv */* . || true; fi fi', {cwd:'/tmp/build'});
    let repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    let tag = `0.${payload.build_number}`;
    if (process.env.EXTRA_BUILD_ARGS) {
      payload.build_args = Object.assign(JSON.parse(process.env.EXTRA_BUILD_ARGS), payload.build_args);
    }
    let build_options = { buildargs:payload.build_args, t:`${repo}:${tag}` }
    await Promise.all([
      common.putObject(payload.build_uuid, fs.createReadStream('/tmp/sources')),
      common.follow(await (docker.buildImage({'context':'/tmp/build', src: ['Dockerfile']}, build_options)),
        common.sendLogs.bind(null, payload, 'build'))
    ]);
    await common.follow(await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
      common.sendLogs.bind(null, payload, 'push'));
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'succeeded', true);
    common.closeLogs(payload);
  } catch (e) {
    console.error(`Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}\n${e}`)
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
  await common.follow(
    await (docker.getImage(`${repo}:${tag}`)).push({tag}, undefined, payload.gm_registry_auth), 
    common.sendLogs.bind(null, payload, 'push'));
  common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'succeeded', true);
  common.closeLogs(payload);
}


async function buildFromStream(payload, stream) {
  let dest = fs.createWriteStream('/tmp/sources');
  dest.on('close', () => build(payload));
  stream.pipe(dest);
  stream.on('error', (err) => {
    console.error(`Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}. Failed to fetch stream.\n${err}`)
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
    console.error(`Build failed for ${payload.app} ${payload.app_uuid} ${payload.build_number}\n${e}`)
    common.sendStatus(payload.callback, payload.callback_auth, payload.build_number, 'failed', false);
    common.closeLogs(payload);
  }
}

execute().catch((err) => console.error(err))
