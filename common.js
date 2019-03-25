const request = require("request-promise-native");
const DockerOde = require("dockerode");
const docker = new DockerOde({socketPath: "/var/run/docker.sock"});
const aws = require("aws-sdk");
const fs = require("fs");

async function haveObject(Key) {
  if(process.env.TEST_MODE) {
    let destFile = `/tmp/archives/${Key}`;
    return fs.existsSync(destFile) ? true : false;
  }
  try {
    await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
      .headObject({Bucket:process.env.S3_BUCKET, Key})
      .promise();
    return true;
  } catch (e) {
    return false;
  }
}

async function getObject(Key) {
  if(process.env.TEST_MODE) {
    if(process.env.DEBUG) {
      console.log(`[debug] reading file in test mode ${Key}`);
    }
    let destFile = `/tmp/archives/${Key}`;
    return fs.createReadStream(destFile);
  }
  return await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .getObject({ Bucket:process.env.S3_BUCKET, Key})
    .createReadStream();
}

function putObject(Key, Body) {
  if(process.env.TEST_MODE) {
    return new Promise((resolve, reject) => {
      if(process.env.DEBUG) {
        console.log(`[debug] writing to file in test mode ${Key}`);
      }
      let destFile = `/tmp/archives/${Key}`;
      let o = fs.createWriteStream(destFile);
      if(Body.pipe) {
        Body.pipe(o);
      } else {
        o.write(Body);
      }
      o.on("close", () => resolve());
      o.on("error", (e) => reject(e));
    });
  }
  return (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .putObject({ Bucket:process.env.S3_BUCKET, Key, ACL:"authenticated-read", ContentType:"application/octet-stream", Body})
    .promise();
}

async function sendStatus(uri, authorization, id, status, building) {
  try {
    if(uri) {
      await request({uri, headers:{authorization, "content-type":"application/json"}, method:"post", body:JSON.stringify({id, status, building, "type":"buildshuttle"})});
    }
  } catch (e) {
    console.error(`Unable to send callback status to ${uri}:${e.message}\n${e.stack}`);
  }
}

function log(...args) {
  if(process.env.TEST_MODE) {
    console.log("    -", ...args);
  } else {
    console.log(...args);
  }
}

module.exports = {
  log,
  haveObject,
  getObject,
  putObject,
  sendStatus,
};