const url = require('url');
const DockerOde = require('dockerode');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const debug = require('debug')('buildshuttle-worker');
const dns = require('dns');
const common = require('./common.js');

// default is 20 minutes.
const timeoutInMs = process.env.TIMEOUT_IN_MS
  ? parseInt(process.env.TIMEOUT_IN_MS, 10)
  : (20 * 60 * 1000);

const docker = new DockerOde(process.env.DOCKER_BUILD_SETTINGS
  ? JSON.parse(process.env.DOCKER_BUILD_SETTINGS)
  : { socketPath: '/var/run/docker.sock' });

function printLogs(event) {
  if (event.stream) {
    event.stream = event.stream.toString().replace(/^[\n\r]+|[\n\r]+$/g, '');
  }
  if (event.status) {
    event.status = event.status.toString().replace(/^[\n\r]+|[\n\r]+$/g, '');
  }
  if (event.progress) {
    event.progress = event.progress.toString().replace(/^[\n\r]+|[\n\r]+$/g, '');
  }
  const message = [event.status, event.progress, event.stream]
    .filter((x) => !!x).reduce((a, arg) => `${a} ${arg}`, '')
    .trim();
  if (message !== '') {
    process.stdout.write(`${message}\n`);
  }
}

function calcBuildArgs(buildArgs) {
  if (process.env.EXTRA_BUILD_ARGS) {
    buildArgs = Object.assign(JSON.parse(process.env.EXTRA_BUILD_ARGS), buildArgs);
  }
  // Ensure the user cannot submit any obnoxious key values that might corrupt the build.
  const newBuildArgs = {};
  Object.keys(buildArgs).forEach((x) => {
    newBuildArgs[x.replace(/([^A-Za-z0-9_]+)/g, '')] = buildArgs[x];
  });
  return newBuildArgs;
}

function calcDockerFile(newBuildArgs, filePath) {
  let newDockerFile = [];
  fs.readFileSync(filePath).toString('utf8').split('\n').forEach((line) => {
    newDockerFile.push(line);
    if (line.startsWith('FROM ')) {
      newDockerFile = newDockerFile.concat(Object.keys(newBuildArgs).map((x) => `ARG ${x}`));
    }
  });
  return newDockerFile.join('\n');
}

function follow(stream, onProgress) {
  return new Promise((resolve, reject) => docker.modem.followProgress(stream,
    (err, output) => (err ? reject(err) : resolve(output)), onProgress));
}

async function build(payload) {
  debug(`beginning general build task ${payload.build_uuid}`);

  try {
    common.log(`Generating build for ${payload.app}-${payload.space} build uuid ${payload.build_uuid}`);
    if (payload.repo) {
      common.log(`Getting source code for ${payload.repo}/${payload.branch} SHA ${payload.sha}...`);
    }
    execSync('tar zxf /tmp/sources -C /tmp/build || unzip /tmp/sources -d /tmp/build', {
      cwd: '/tmp', stdio: ['inherit', 'inherit', 'inherit'],
    });
    // Unzip will put a single directory with the original folder name inside of /tmp/build, for example
    // if the original zip was a folder "foobar" then a new folder /tmp/build/foobar will be unzipped, this
    // will remove all the contents backc to /tmp/build.
    execSync('if [ `ls -d */ | wc -l` = "1" ]; then if [ `ls . | wc -l` = "1" ]; then mv */.[!.]* . || true; mv */* . || true; fi fi', { cwd: '/tmp/build', stdio: ['inherit', 'inherit', 'inherit'] }); // eslint-disable-line
    debug('extracted sources');
    const newBuildArgs = calcBuildArgs(payload.build_args || {});
    fs.writeFileSync('/tmp/build/Dockerfile', calcDockerFile(newBuildArgs, '/tmp/build/Dockerfile'));
    const repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    const tag = `1.${payload.build_number}`;
    const buildOptions = {
      buildargs: newBuildArgs,
      t: `${repo}:${tag}`,
      labels: {
        app: payload.app,
        space: payload.space,
        build_uuid: payload.build_uuid,
        app_uuid: payload.app_uuid,
      },
    };
    if (payload.gm_registry_auth) {
      buildOptions.registryconfig = {};
      buildOptions.registryconfig[payload.gm_registry_host] = payload.gm_registry_auth;
      const auth = JSON.parse(JSON.stringify(payload.gm_registry_auth));
      if (!auth.serveraddress) {
        auth.serveraddress = payload.gm_registry_host;
      }
      debug(`attempting to authorize ${auth.serveraddress} with ${auth.username}`);
      try {
        await docker.checkAuth(auth);
      } catch (e) {
        common.log(`Error, unable to authorize ${auth.serveraddress}: ${e.message}\n${e.stack}`);
      }
      if (!auth.serveraddress.startsWith('https://')) {
        debug(`attempting to authorize (https) ${auth.serveraddress} with ${auth.username}`);
        auth.serveraddress = `https://${auth.serveraddress}`;
        try {
          await docker.checkAuth(auth);
        } catch (e) {
          common.log(`Error, unable to authorize ${auth.serveraddress}: ${e.message}\n${e.stack}`);
        }
      }
      if (process.env.EXTRA_DOCKER_REGISTRY_CONFIG) {
        debug('adding extra docker registry');
        const extraDockerRegistryConfig = JSON.parse(process.env.EXTRA_DOCKER_REGISTRY_CONFIG);
        buildOptions.registryconfig.push(extraDockerRegistryConfig);
        console.log('registryConfig====>>>>>', buildOptions.registryconfig);
      }
    }

    buildOptions.nocache = !!((process.env.TEST_MODE || process.env.NO_CACHE === 'true'));
    debug('starting build');
    const buildStream = await docker.buildImage({ context: '/tmp/build' }, buildOptions);
    debug('started build');
    const sourcePushPromise = common.putObject(payload.build_uuid, fs.createReadStream('/tmp/sources'));
    await follow(buildStream, printLogs);
    debug(`obtaining image ${repo}:${tag}`);
    const image = docker.getImage(`${repo}:${tag}`);
    debug(`tagging ${repo}:latest`);
    await image.tag({ repo, tag: 'latest' });
    debug(`tagged ${repo}:latest`);
    debug(`pushing image ${repo}:${tag}`);
    const pushRequest = await image.push({ tag }, undefined, payload.gm_registry_auth);
    debug(`streaming push for image ${repo}:${tag}`);
    await follow(pushRequest, printLogs);
    debug(`pushed image ${repo}:${tag}`);
    debug(`pushing image ${repo}:latest`);
    const pushRequestLatest = await image.push({ tag: 'latest' }, undefined, payload.gm_registry_auth);
    debug(`streaming push for image ${repo}:latest`);
    await follow(pushRequestLatest, printLogs);
    debug(`pushed image ${repo}:latest`);
    await sourcePushPromise;
    process.exit(0);
  } catch (e) {
    common.log(`Error during build (docker build process): ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
    process.exit(127);
  }
}

async function buildFromDocker(payload) {
  debug('build pulling and pushing existing image');
  try {
    const parsedURL = new url.URL(payload.sources);
    let pullAuth = {};
    if (parsedURL.username && parsedURL.password) {
      pullAuth = { username: parsedURL.username, password: parsedURL.password };
    }
    if (payload.docker_login) {
      pullAuth = { username: payload.docker_login, password: payload.docker_password };
    }
    payload.sources = parsedURL.host + parsedURL.pathname;
    debug(`pulling image ${payload.sources}`);
    await follow(await docker.pull(payload.sources, {}, undefined, pullAuth), printLogs);
    debug(`pulled image ${payload.sources}`);

    const repo = `${payload.gm_registry_host}/${payload.gm_registry_repo}/${payload.app}-${payload.app_uuid}`;
    const tag = `1.${payload.build_number}`;
    debug(`tagging image ${payload.sources}`);
    await (docker.getImage(payload.sources)).tag({ repo, tag });
    await (docker.getImage(payload.sources)).tag({ repo, tag: 'latest' });
    debug(`tagged image ${payload.sources}`);
    debug(`pushing image ${repo}:${tag}`);
    await follow(await (docker.getImage(`${repo}:${tag}`)).push({ tag }, undefined, payload.gm_registry_auth), printLogs);
    debug(`pushed image ${repo}:${tag}`);
    debug(`pushing image ${repo}:latest`);
    await follow(await (docker.getImage(`${repo}:latest`)).push({ tag: 'latest' }, undefined, payload.gm_registry_auth), printLogs); // eslint-disable-line
    debug(`pushed image ${repo}:latest`);
    process.exit(0);
  } catch (e) {
    common.log(`Error during build (docker build from docker process): ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
    process.exit(127);
  }
}

async function buildFromStream(payload, stream) {
  debug('downloading sources from stream');
  const dest = fs.createWriteStream('/tmp/sources');
  dest.on('close', () => {
    debug('downloaded sources from stream');
    build(payload);
  });
  dest.on('error', (e) => {
    common.log(`Error during build (attempting to stream to sources): ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
    process.exit(127);
  });
  stream.pipe(dest);
  stream.on('error', (e) => {
    common.log(`Error during build (attempting to stream from http): ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
    process.exit(127);
  });
}

async function buildFromBuffer(payload, buffer) {
  debug('fetching payload from buffer (data uri)');
  fs.writeFileSync('/tmp/sources', buffer);
  build(payload);
}

async function execute() {
  debug(`Received dns servers for worker: ${dns.getServers()}`);
  const payload = JSON.parse(Buffer.from(process.env.PAYLOAD, 'base64'));
  try {
    const parsedURL = new url.URL(payload.sources);
    if (parsedURL.protocol.toLowerCase() === 'docker:') {
      buildFromDocker(payload);
    } else if (parsedURL.protocol === 'data:') {
      let data = parsedURL.pathname;
      while (data[0] === '/' || data[0] === ',') {
        data = data.substring(1);
      }
      if (data.startsWith('base64,')) {
        data = Buffer.from(data.substring(7), 'base64');
      }
      buildFromBuffer(payload, data);
    } else if (parsedURL.protocol.startsWith('http')) {
      const connector = (parsedURL.protocol === 'https:' ? https : http);
      connector.get(payload.sources, (res) => { // eslint-disable-line
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return connector.get(res.headers.location, buildFromStream.bind(null, payload));
        } if (res.statusCode > 199 || res.statusCode < 300) {
          buildFromStream(payload, res);
        } else if (res) {
          common.log(`Error from build (fetching stream returned invalid code ${res.statuCode} ${res.status}).`);
          process.exit(127);
        } else {
          common.log('No response was returned.');
          process.exit(127);
        }
      }).on('error', (e) => {
        common.log(`Error during build (fetching streams): ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
        process.exit(127);
      });
    }
  } catch (e) {
    common.log(`Error during build: ${e.message}\n${e.stack}\n${JSON.stringify(e)}`);
    process.exit(127);
  }
}

process.stdout.setNoDelay(true);
process.stderr.setNoDelay(true);

debug(`worker started with timeout: ${timeoutInMs / 1000 / 60} minutes`);
setTimeout(() => {
  try {
    common.log('Build timed out (failed).');
    process.exit(126);
  } catch (e) {
    common.log(`Failed to terminate build on timeout: ${e.message}\n${e.stack}`);
  }
}, timeoutInMs);

execute().catch((err) => {
  console.log(err);
  process.exit(125);
});
