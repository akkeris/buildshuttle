'use strict'

const path = require('path');
const url = require('url');
const http = require('http');
const https = require('https');
const httph = require('./httph')
const fs = require('fs')
const jenkins_api = require('./jenkins.js');
const jenkins = jenkins_api.init(httph.clean_forward_slash(process.env.JENKINS_URL));
const shuttle_url = process.env.BUILD_SHUTTLE_HOST || "localhost:5000"
const {promisify} = require('util');

let aws = require('aws-sdk');
let s3 = new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY});
let s3stream = require('s3-upload-stream')(s3);
let s3_head = promisify(s3.headObject)
let s3_get = promisify(s3.getObject)


// private
async function check_job_exists(app_name, app_uuid) {
  try {
    return await jenkins.job_info(`${app_name}-${app_uuid}`);
  } catch (e) {
    if(e.code === 404) {
      throw new httph.NotFoundError("The specified job could not be found.")
    }
    console.error(e)
    if(e.stack) console.error(e.stack)
    throw new httph.ServiceUnavailableError("Jenkins did not respond with the applications job info.")
  }
}

// private  ASSUMES THE APPLICATIN EXISTS!! 
//          THIS IS DANGEROUS IF YOU EXECUTE IT WITHOUT
//          CHECKING IF THE APP EXISTS FIRST.
const job_config = process.env.REGISTRY_NOAUTH ? fs.readFileSync('jenkins_build_template_noauth.xml').toString('utf8') : fs.readFileSync('jenkins_build_template.xml').toString('utf8');
async function create_job_if_needed(app_name, app_uuid) {
  try { 
    return await check_job_exists(app_name, app_uuid);
  } catch (e) {
    if(e instanceof httph.NotFoundError) {
      try {
        return await jenkins.create_job(`${app_name}-${app_uuid}`, job_config);
      } catch (e) {
        console.error(e)
        if(e.stack) console.error(e.stack)
        throw new httph.ServiceUnavailableError("Jenkins did not create the application job correctly.")
      }
    }
  }
}

// private THIS ALSO ASSUMES THE APPLICATION EXISTS!!
//          THIS CAN BE DANGEROUS TO RUN IF THE APPLICATION DOES NOT!
async function delete_job_if_exists(app_name, app_uuid) {
  try {
    let build_info = await check_job_exists(app_name, app_uuid)
    let del_info = await jenkins.delete_job(`${app_name}-${app_uuid}`)
    return del_info
  } catch (e) {
    if(!(e instanceof httph.NotFoundError)) {
      let last_build = await jenkins.last_build_info(`${app_name}-${app_uuid}`)
      await jenkins.stop_build(`${app_name}-${app_uuid}`, last_build.id)
      try {
        let del_info = await jenkins.delete_job(`${app_name}-${app_uuid}`)
        return del_info
      } catch (e) {
        console.error(`ERORR: Unable to remove build for ${app_name}-${app_uuid}`)
        console.error(e)
        return null
      }
    } else if (e instanceof httph.NotFoundError) {
      return null
    } else {
      throw e
    }
  }
}

function build_exists_in_cache(req, res) {
  return new Promise((resolve, reject) => {
    s3.headObject({Bucket:process.env.S3_BUCKET, Key:req.url.replace('/','')}, (err, result) => {
      if(err) {
        console.log('cannot find build cache for ', req.url.replace('/',''), err);
        return reject(err)
      }
      res.writeHead(200, {'content-type':result.ContentType, 'content-length':result.ContentLength})
      res.end()
    });
  })
}


async function get_build_cache(req, res) {
  return new Promise((resolve, reject) => {
    s3.getObject({Bucket:process.env.S3_BUCKET, Key:req.url.replace('/','')}, (err, result) => {
      if(err) {
        console.log('cannot find build cache for ', req.url.replace('/',''), err);
        return reject(err)
      }
      res.writeHead(200, {'content-type':result.ContentType, 'content-length':result.ContentLength});
      res.write(result.Body);
      res.end();
    })
  })
}

async function stop_build(req, res) {
  let regex = /^\/([A-z0-9\-]+)\/([A-z0-9\-]+)$/;
  let app_key = httph.first_match(req.url, regex)
  let build_key = httph.second_match(req.url, regex)
  let content = await jenkins.stop_build(app_key, build_key)
  httph.ok_response(res, {"status":"ok"})
}

async function remove_job(req, res) {
  let regex = /^\/([A-z0-9\-]+)$/;
  let app_key = httph.first_match(req.url, regex)
  let app_name = app_key.split('-')[0]
  let app_uuid = app_key.substring(app_key.indexOf('-') + 1)
  await delete_job_if_exists(app_name, app_uuid)
  httph.ok_response(res, {"status":"ok"})
}

async function get_build_logs(req, res) {
  let regex = /^\/([A-z0-9\-]+)\/([A-z0-9\-]+)\/logs$/;
  let app_key = httph.first_match(req.url, regex)
  let build_key = httph.second_match(req.url, regex)
  let content = await jenkins.job_output(app_key, build_key)
  httph.ok_response(res, content)
}

async function get_build_status(req, res) {
  let regex = /^\/([A-z0-9\-]+)\/([A-z0-9\-]+)\/status$/;
  let app_key = httph.first_match(req.url, regex)
  let build_key = httph.second_match(req.url, regex)
  let content = await jenkins.build_info(app_key, build_key)
  // Jenkins can return content.result = null for pending, or "ABORTED" for stopped, "SUCCESS" for .. well successful builds.

  let status = 'pending'
  switch(content.result) {
    case 'ABORTED':
      status = 'stopped'
      break;
    case 'SUCCESS':
      status = 'succeeded'
      break;
    case 'FAILURE':
      status = 'failed'
      break;
    default:
      status = content.result || 'pending'
      break;
  }
  httph.ok_response(res, JSON.stringify({
    "id":parseInt(content.id, 10),
    "building":content.building,
    "status":status,
    "type":"jenkins"
  }))
}

function upload_code(res, payload, code_stream) {
  return new Promise((resolve, reject) => {
    let upload = s3stream.upload({ Bucket:process.env.S3_BUCKET, Key:payload.build_uuid, ACL:'authenticated-read', ContentType:'application/octet-stream'})
    upload.on('error', reject)
    upload.on('uploaded', (details) => {
      payload.sources = 'https://' + shuttle_url + '/' + payload.build_uuid;
      jenkins.build(payload.app + '-' + payload.app_uuid, payload).then((data) => {
        httph.ok_response(res, "The build was successfully submitted.")
        resolve(data)
      }).catch(reject)
    })
    if(code_stream.pipe) {
      code_stream.pipe(upload)
    } else {
      upload.write(code_stream)
      upload.end()
    }
  });
}

async function create_build(req, res) {
  let payload = await httph.buffer_json(req)
  await create_job_if_needed(payload.app, payload.app_uuid)
  if(payload.sources.startsWith('http://') || payload.sources.startsWith('https://')) {
    return new Promise((resolve, reject) => {
      let request = payload.sources.startsWith('http://') ? http : https;
      request.get(url.parse(payload.sources), (response) => {
        if(response.statusCode === 302 || response.statusCode === 301) {
          request.get(response.headers['location'], (response) => {
            upload_code(res, payload, response).catch(reject)
          }).on('error', reject);
        } else {
          upload_code(res, payload, response).catch(reject)
        }
      }).on('error', reject);
    })
  } else if (payload.sources.startsWith('data:')) {
    let source = payload.sources.substring(5)
    source = new Buffer(source.startsWith("base64,") ? source.substring(7) : source, source.startsWith("base64,") ? 'base64' : 'utf8')
    await upload_code(res, payload, source);
  } else {
    let data = await jenkins.build(payload.app + '-' + payload.app_uuid, payload)
    httph.ok_response(res, "The build was successfully submitted.")
  }
}

function http_server(req, res) {
  (async function() {
    try {
      if(req.url === '/octhc') {
        httph.ok_response(res, 'overall_status=good')
      } else if(req.method.toLowerCase() === 'post' && req.url === '/') {
        await create_build(req, res)
      } else if(req.method.toLowerCase() === 'get' && req.url.match(/^\/[A-z0-9\-]+$/) !== null) {
        await get_build_cache(req, res)
      } else if(req.method.toLowerCase() === 'delete' && req.url.match(/^\/[A-z0-9\-]+$/) !== null) {
        await remove_job(req, res)
      } else if(req.method.toLowerCase() === 'delete' && req.url.match(/^\/([A-z0-9\-]+)\/([A-z0-9\-]+)$/) !== null) {
        await stop_build(req, res)
      } else if(req.method.toLowerCase() === 'get' && req.url.match(/^\/([A-z0-9\-]+)\/([A-z0-9\-]+)\/logs$/) !== null) {
        await get_build_logs(req, res)
      } else if(req.method.toLowerCase() === 'get' && req.url.match(/^\/([A-z0-9\-]+)\/([A-z0-9\-]+)\/status$/) !== null) {
        await get_build_status(req, res)
      } else if(req.method.toLowerCase() === 'head' && req.url.match(/^\/[A-z0-9\-]+$/) !== null) {
        await build_exists_in_cache(req, res)
      } else {
        throw new httph.NotFoundError('Unable to find requested resource.')
      }
    } catch (e) {
      console.error(e.stack)
      console.error(e.message)
      console.error(e)
      httph.respond(e.code || 500, res, e.message || "Internal Server Error")
    }
  })().catch(console.error)
}

let http_listener = http.createServer(http_server)
http_listener.listen(process.env.PORT || 9000)

if (require.main === module) {
  process.on('uncaughtException', (e) => {
    console.error(e.message);
    console.error(e.stack);
  })
}

module.exports = {http_listener}
