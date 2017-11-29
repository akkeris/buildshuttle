"use strict"

const uuid = require('uuid')
const ngrok = require('ngrok')
const http = require('http')
process.env.PORT = 5000
process.env.AUTH_KEY = 'hello'
process.env.TEST_MODE = 'true'

describe("builds: create, status, result, stop, delete", function() {  
  this.timeout(300000);
  let last_payload = null
  let ngrok_url = null
  let ngrok_listener = null
  let jenkins_build_id = null

  const running_app = require('../index.js');
  const httph = require('../httph.js');
  const expect = require("chai").expect;
  let build_uuid = uuid.v4()
  let app_uuid = uuid.v4()

  it("covers creating dependent ngrok url", (done) => {
    // create ngok services
    ngrok.connect({authtoken:process.env.NGROK_TOKEN, addr:9090}, (err, url) => {
      ngrok_url = url;
      done()
    })
    ngrok_listener = http.createServer((req, res) => {
      let data = Buffer.alloc(0)
      req.on('data', (x) => data = Buffer.concat([data, x]))
      req.on('end', () => {
        last_payload = {url:req.url, headers:req.headers, data:data.toString("utf8")}
        res.writeHead(200, {})
        res.end()
      })
    })
    ngrok_listener.listen(9090);
  })

  it("covers creating a build", (done) => {
    last_payload = null
    let build_options = {
      "sha":"sha_field",
      "app":"alamotest1",
      "space":"default",
      "branch":"branch_field",
      "repo":"repo_field",
      "org":"test",
      "build_uuid":build_uuid,
      "app_uuid":app_uuid,
      "sources":"",
      "build_options":"",
      "callback":ngrok_url,
      "callback_auth":"hello123",
      "gm_registry_host":process.env.TEST_GM_REGISTRY_HOST,
      "gm_registry_repo":process.env.TEST_GM_REGISTRY_REPO,
      "docker_registry":"docker.io/akkeris/test-sample:latest",
      "docker_login":"",
      "docker_password":""
    }
    httph.request('post', `http://localhost:5000/`, {}, JSON.stringify(build_options), (err, data) => {
      if(err) {
        console.error(err)
      }
      expect(err).to.be.null;
      expect(data).to.be.an('string')
      expect(data).to.equal("The build was successfully submitted.")
      done();
    })
  })

  it("covers waiting for callback from build (start)", (done) => {
    let wait = function() {
      if(last_payload !== null) {
        let data = JSON.parse(last_payload.data);
        last_payload = null
        expect(data.id).to.be.a('number')
        expect(data.type).to.equal('jenkins')
        expect(data.building).to.equal(true)
        expect(data.status).to.equal('pending')
        jenkins_build_id = data.id
        done()
      } else {
        setTimeout(wait, 500);
      }
    }
    wait()
  });
  it("covers getting status of a build", (done) => {
    expect(jenkins_build_id).to.be.a('number')
    httph.request('get', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id + '/status', {}, null, (err, data) => {
      if(err) {
        console.log(err)
      }
      expect(err).to.be.null;
      data = JSON.parse(data)
      expect(data.id).to.equal(jenkins_build_id)
      expect(data.building).to.equal(true)
      expect(data.status).to.equal("pending")
      expect(data.type).to.equal("jenkins")
      done()
    })
  });
  it("covers stopping a build", (done) => {
    expect(jenkins_build_id).to.be.a('number')
    httph.request('delete', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id, {}, null, (err, data) => {
      if(err) {
        console.log(err)
      }
      expect(err).to.be.null;
      data = JSON.parse(data)
      expect(data.status).to.equal("ok")
      done()
    })
  });

  it("covers getting stopped status of a build", (done) => {
    expect(jenkins_build_id).to.be.a('number')
    httph.request('get', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id + '/status', {}, null, (err, data) => {
      if(err) {
        console.log(err)
      }
      expect(err).to.be.null;
      data = JSON.parse(data)
      expect(data.id).to.equal(jenkins_build_id)
      expect(data.building).to.equal(false)
      expect(data.status).to.equal("stopped")
      expect(data.type).to.equal("jenkins")
      done()
    })
  });

  it("covers creating a second build", (done) => {
    last_payload = null
    let build_options = {
      "sha":"sha_field",
      "app":"alamotest1",
      "space":"default",
      "branch":"branch_field",
      "repo":"repo_field",
      "org":"test",
      "build_uuid":build_uuid,
      "app_uuid":app_uuid,
      "sources":"",
      "build_options":"",
      "callback":ngrok_url,
      "callback_auth":"hello123",
      "gm_registry_host":process.env.TEST_GM_REGISTRY_HOST,
      "gm_registry_repo":process.env.TEST_GM_REGISTRY_REPO,
      "docker_registry":"docker.io/akkeris/test-sample:latest",
      "docker_login":"",
      "docker_password":""
    }
    httph.request('post', `http://localhost:5000/`, {}, JSON.stringify(build_options), (err, data) => {
      if(err) {
        console.error(err)
      }
      expect(err).to.be.null;
      expect(data).to.be.an('string')
      expect(data).to.equal("The build was successfully submitted.")
      done();
    })
  });

  it("covers getting result of a build", (done) => {
    let wait = function() {
      if(last_payload !== null) {
        let data = JSON.parse(last_payload.data);
        if(data.status !== 'pending') {
          last_payload = null
          expect(data.id).to.be.a('number')
          expect(data.type).to.equal('jenkins')
          expect(data.building).to.equal(true)
          expect(data.status).to.equal('succeeded')
          jenkins_build_id = data.id

          httph.request('get', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id + '/logs', {}, null, (err, data) => {
            if(err) {
              console.error(err)
            }
            expect(err).to.be.null;
            expect(data).to.be.an('string')
            done()
          })
        } else {
          last_payload = null
          setTimeout(wait, 500);
        }
      } else {
        setTimeout(wait, 500);
      }
    }
    wait()
  });

  it("covers getting success status of a build", (done) => {
    setTimeout(function() {
      expect(jenkins_build_id).to.be.a('number')
      httph.request('get', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id + '/status', {}, null, (err, data) => {
        if(err) {
          console.log(err)
        }
        expect(err).to.be.null;
        data = JSON.parse(data)
        expect(data.id).to.equal(jenkins_build_id)
        expect(data.status).to.equal("succeeded")
        expect(data.building).to.equal(false)
        expect(data.type).to.equal("jenkins")
        done()
      })
    }, 10000)
  });


  it("covers creating a third (failure) build", (done) => {
    last_payload = null
    let build_options = {
      "sha":"sha_field",
      "app":"alamotest1",
      "space":"default",
      "branch":"branch_field",
      "repo":"repo_field",
      "org":"test",
      "build_uuid":build_uuid,
      "app_uuid":app_uuid,
      "sources":"",
      "build_options":"",
      "callback":ngrok_url,
      "callback_auth":"hello123",
      "gm_registry_host":process.env.TEST_GM_REGISTRY_HOST,
      "gm_registry_repo":process.env.TEST_GM_REGISTRY_REPO,
      "docker_registry":"docker.io/akkeris/test-sample-does-not-exist:latest",
      "docker_login":"",
      "docker_password":""
    }
    httph.request('post', `http://localhost:5000/`, {}, JSON.stringify(build_options), (err, data) => {
      if(err) {
        console.error(err)
      }
      expect(err).to.be.null;
      expect(data).to.be.an('string')
      expect(data).to.equal("The build was successfully submitted.")
      done();
    })
  });

  it("covers getting result of a failed build", (done) => {
    let wait = function() {
      if(last_payload !== null) {
        let data = JSON.parse(last_payload.data);
        if(data.status !== 'pending') {
          expect(last_payload.headers['authorization']).to.equal('hello123')
          last_payload = null
          expect(data.id).to.be.a('number')
          expect(data.type).to.equal('jenkins')
          expect(data.building).to.equal(false)
          expect(data.status).to.equal('failed')
          jenkins_build_id = data.id
          done()
        } else {
          setTimeout(wait, 500);
        }
      } else {
        setTimeout(wait, 500);
      }
    }
    wait()
  });

  it("covers getting failure status of a build", (done) => {
    setTimeout(function() {
      expect(jenkins_build_id).to.be.a('number')
      httph.request('get', 'http://localhost:5000/alamotest1-' + app_uuid + '/' + jenkins_build_id + '/status', {}, null, (err, data) => {
        if(err) {
          console.log(err)
        }
        expect(err).to.be.null;
        data = JSON.parse(data)
        expect(data.id).to.equal(jenkins_build_id)
        expect(data.status).to.equal("failed")
        expect(data.building).to.equal(false)
        expect(data.type).to.equal("jenkins")
        done()
      })
    }, 10000)
  });

  it("covers deleting job", (done) => {
    httph.request('delete', 'http://localhost:5000/alamotest1-' + app_uuid, {}, null, (err, data) => {
      if(err) {
        console.error(err)
      }
      expect(err).to.be.null;
      expect(data).to.be.an('string')
      expect(JSON.parse(data).status).to.equal("ok")
      running_app.http_listener.close()
      ngrok_listener.close()
      ngrok.disconnect()
      ngrok.kill()
      done()
    })
  });
})