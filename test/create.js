const test = require('./support/init.js')
const request = require('request-promise-native')
const expect = require("chai").expect;

describe("creating builds", function() {
  this.timeout(100000);
  let pending = false
  let successful = false
  let pending2 = false
  let successful2 = false
  let url = null
  test.events.on('loaded', (u) => { url = u });
  
  it("test creating a build", async () => {
    test.events.removeAllListeners('callback')
    let listener = (body) => {
      expect(body.id).equal(1)
      expect(body.type).equal("buildshuttle")
      if(body.status === "pending") {
        pending = true;
      } else if (body.status === "succeeded") {
        successful = true;
      } else {
        console.log('received unexpected build status:', body.status)
        expect(false).to.equal(true);
      }
    }
    test.events.on('callback', listener)
    while(url === null) {
      await test.wait()
    }
    let response = await request(
    {
      "method":"post",
      "headers":{
        "content-type":"application/json"
      },
      "uri":"http://localhost:9000",
      "body":JSON.stringify({
        "sources":"https://github.com/akkeris/preview-app-test-repo/archive/master.zip",
        "app":"test",
        "space":"test",
        "app_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf3",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":1,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf3",
        "callback":url,
        "callback_auth":"foobar"
      })
    });
    expect(response).to.equal('{"status":"ok"}')
    while(pending === false) {
      await test.wait()
    }
    while(successful === false) {
      await test.wait()
    }
    test.events.removeListener('callback', listener)
    test.events.removeAllListeners('callback')
  });

  let invalid_response = false;
  it("test creating multiple builds", async () => {
    test.events.removeAllListeners('callback')
    pending = false;
    successful = false;
    let listener = (body) => {
      if (body.id === 2) {
        expect(body.type).equal("buildshuttle")
        if(body.status === "pending") {
          pending = true;
        } else if (body.status === "succeeded") {
          successful = true;
        } else {
          expect(false).to.equal(true);
        }
      } else if (body.id === 3) {
        expect(body.type).equal("buildshuttle")
        if(body.status === "pending") {
          pending2 = true;
        } else if (body.status === "succeeded") {
          successful2 = true;
        } else {
          invalid_response = true;
          expect(false).to.equal(true);
        }
      } else {
        console.log('the build had an unexpected id:', body)
        expect(false).to.equal(true);
      }
    }
    test.events.on('callback', listener)
    request(
    {
      "method":"post",
      "headers":{
        "content-type":"application/json"
      },
      "uri":"http://localhost:9000",
      "body":JSON.stringify({
        "sources":"https://github.com/akkeris/preview-app-test-repo/archive/master.zip",
        "app":"test2",
        "space":"test",
        "app_uuid":"f6bce159-87a7-437f-bed3-2da4e44d9cff",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":2,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf5",
        "callback":url,
        "callback_auth":"foobar"
      })
    });
    request(
    {
      "method":"post",
      "headers":{
        "content-type":"application/json"
      },
      "uri":"http://localhost:9000",
      "body":JSON.stringify({
        "sources":"https://github.com/akkeris/preview-app-test-repo/archive/master.zip",
        "app":"test3",
        "space":"test",
        "app_uuid":"56bce159-87a7-437f-bed3-2da4e44d9caa",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":3,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf6",
        "callback":url,
        "callback_auth":"foobar"
      })
    });
    while(pending === false) {
      await test.wait()
    }
    while(successful === false) {
      await test.wait()
    }
    while(pending2 === false) {
      await test.wait()
    }
    while(successful2 === false) {
      await test.wait()
    }
    expect(invalid_response).to.equal(false);
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });
  it("ensure build source code can be recieved post-build", async () => {
    let code = await request("http://localhost:9000/56bce159-87a7-437f-bed3-2da4e44d9cf6");
  })
})