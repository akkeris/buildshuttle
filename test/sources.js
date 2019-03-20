const test = require('./support/init.js')
const request = require('request-promise-native')
const expect = require("chai").expect;

describe("various sources for builds", function() {
  this.timeout(100000);
  let pending = false
  let successful = false
  let url = null
  test.events.on('loaded', (u) => { url = u });
  
  it("test creating a build from docker", async () => {
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
        "sources":"docker://docker.io/akkeris/buildshuttle:latest",
        "app":"test3",
        "space":"test3",
        "app_uuid":"56bce159-87a7-437f-bed3-2da4e44d9aaa",
        "gm_registry_host":"docker.io",
        "gm_registry_repo":"akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":1,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9eee",
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
  });

  it("test creating a build from a data uri", async () => {
    test.events.removeAllListeners('callback')
    pending = false
    successful = false
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
        "sources":"data:base64,UEsDBAoAAAAAAPammUoAAAAAAAAAAAAAAAAIABwAc29tZWRpci9VVAkAAzAMAFlnDABZdXgLAAEEij3QXQQUAAAAUEsDBBQAAAAIAMaqTUrtS54nawAAAIUAAAASABwAc29tZWRpci9Eb2NrZXJmaWxlVVQJAAP0haJYMQwAWXV4CwABBIo90F0EFAAAAHML8vdVyMtPSbVKLErPz+MKCvVTyM1OySxS0C1Q0C8tLtIvLkrWTywo4Ar3D/J28QxCFXT2D4hU0EMVAxmRV5CrkJlXXJKYk8PlGhHgH+yqYGlgYMDl7OuiEK2gBJRW0lFQAsoXlSgpxAIAUEsDBBQAAAAIAMaqTUroz2k/cQEAAIUCAAAQABwAc29tZWRpci9pbmRleC5qc1VUCQAD9IWiWDEMAFl1eAsAAQSKPdBdBBQAAAB1UU1LAzEQve+vGPayWbrGrXgThQqFKtpKW71YkWV3WkNjopPZqmj/u5O2+AUGApnJzHtv3qRtQAhMpuY0SWrvAsMD8xMcA+FzawhVFuMsP0qeyNcYgka30uP+9Ho8vL/pXVz3pfbfr48PSAMyG7cQQG7JwaqyLcK8MhYbne44A9IKSZAima4JK8bJJqeUCCmkOeRwfALvCcS3fiHDOMCqUQdlWcD7WgQCmHms1i1ZbVyDr6O5ykSTIe8e0XGWwwnsdfMNyg8cdT4ZDXW0wS3M/E39GCff4K4BrRj1t+2/sbc9O6XoGiWJKHA7pfZOZbU1IqhP5CkrQCFRAcHXS+SvMbfhpj8bTKdX+13dhcOyhNOqgbFsBwPPaObizXYMiUUGIz6WkY3PHAtlZZX6QjWdTlQXbfcWtfULlb54Wor7LIBwm0Ln1z4Ho8l02LvsSzq9gyW+wd+KXxuXKjA7WkgLMFFZAd1SzrcF1gRGF3cnyU9QSwMEFAAAAAgAxqpNSkmwHUOYAAAA6QAAABQAHABzb21lZGlyL3BhY2thZ2UuanNvblVUCQAD9IWiWDEMAFl1eAsAAQSKPdBdBBQAAABVj7sOgzAMRXe+wvLAVCFYWasOnbuyRIkrXJWExgEhEP/eJCBVHX3O9WsrANCqgbAF/Ey8riR4SXAmL+xs4k1VV/VBDYn2PIbTHHBQnCu2hpbqdQ44ghLFFssEgvIh5awzBH/haANJlqR7Bx3evHe+BesgCZCRND+ZTIdQlkALB2gwdu55l5pC7/zvojdrspKfuj+uWOzFF1BLAQIeAwoAAAAAAPammUoAAAAAAAAAAAAAAAAIABgAAAAAAAAAEADtQQAAAABzb21lZGlyL1VUBQADMAwAWXV4CwABBIo90F0EFAAAAFBLAQIeAxQAAAAIAMaqTUrtS54nawAAAIUAAAASABgAAAAAAAEAAACkgUIAAABzb21lZGlyL0RvY2tlcmZpbGVVVAUAA/SFolh1eAsAAQSKPdBdBBQAAABQSwECHgMUAAAACADGqk1K6M9pP3EBAACFAgAAEAAYAAAAAAABAAAApIH5AAAAc29tZWRpci9pbmRleC5qc1VUBQAD9IWiWHV4CwABBIo90F0EFAAAAFBLAQIeAxQAAAAIAMaqTUpJsB1DmAAAAOkAAAAUABgAAAAAAAEAAACkgbQCAABzb21lZGlyL3BhY2thZ2UuanNvblVUBQAD9IWiWHV4CwABBIo90F0EFAAAAFBLBQYAAAAABAAEAFYBAACaAwAAAAA=",
        "app":"test",
        "space":"test",
        "app_uuid":"56bce159-87a7-437f-bed3-2da4e44d9ddd",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":1,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9fff",
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
  });
})