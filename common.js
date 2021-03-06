const request = require('request-promise-native');
const debug = require('debug')('buildshuttle-worker');
const aws = require('aws-sdk');
const fs = require('fs');

function log(...args) {
  if (process.env.TEST_MODE) {
    console.log('    -', ...args);
  } else {
    console.log(...args);
  }
}

async function haveObject(Key) {
  if (process.env.TEST_MODE) {
    const destFile = `/tmp/archives/${Key}`;
    return !!fs.existsSync(destFile);
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await (new aws.S3({ accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }))
      .headObject({ Bucket: process.env.S3_BUCKET, Key })
      .promise();
    return true;
  } catch (e) {
    return false;
  }
}

async function getObject(Key) {
  if (process.env.TEST_MODE) {
    debug(`reading file in test mode for ${Key}`);
    const destFile = `/tmp/archives/${Key}`;
    return fs.createReadStream(destFile);
  }
  debug(`reading s3 object ${Key}`);

  await new Promise((resolve) => setTimeout(resolve, 100));
  return (new aws.S3({ accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }))
    .getObject({ Bucket: process.env.S3_BUCKET, Key })
    .createReadStream();
}

function putObject(Key, Body) {
  if (process.env.TEST_MODE) {
    return new Promise((resolve, reject) => {
      debug(`writing to file in test mode for ${Key}`);
      try { fs.mkdirSync('/tmp/archives'); } catch (e) { /* ignore error */ }
      const destFile = `/tmp/archives/${Key}`;
      const o = fs.createWriteStream(destFile);
      if (Body.pipe) {
        Body.pipe(o);
      } else {
        o.write(Body);
        o.end();
      }
      o.on('close', resolve);
      o.on('error', reject);
    });
  }
  return (new aws.S3({ accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }))
    .putObject({
      Bucket: process.env.S3_BUCKET, Key, ACL: 'authenticated-read', ContentType: 'application/octet-stream', Body,
    })
    .promise();
}

async function sendStatus(uri, authorization, id, status, building) {
  try {
    if (uri) {
      debug(`sending "${status}" status for ${id} to ${uri}`);
      await request({
        uri,
        headers: { authorization, 'content-type': 'application/json' },
        method: 'post',
        body: JSON.stringify({
          id, status, building, type: 'buildshuttle',
        }),
      });
    }
  } catch (e) {
    log(`Unable to send callback status to ${uri}:${e.message}\n${e.stack}`);
  }
}

module.exports = {
  log,
  haveObject,
  getObject,
  putObject,
  sendStatus,
};
