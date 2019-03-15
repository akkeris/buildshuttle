
## Creating a build

### Request

```
POST /:app_id/:build_id
{
  "webhooks":{
    "status":"https://token@example.com",
    "logs":"https://user:pass@example.com",
  },
  "metadata":"deploymentt-namespacce",
  "human_readable_info":"Build #3 - https://example.com/repo.git sha #abcdef134",
  "arguments":{"X":"Y"},
  "source":{
    "url":"docker://user:pass@example.com/org/repo:tag",
  },
  "destination":{
    "image":"docker://user:pass@example.com/org/repo:tag",
  },
}
```

The logs and status end point can also take an array. They support https, http and kafka protocols.  The kafka topic is determined by the path, to support multiple kafka brokers use the `failover:` scheme.  For example, `failover(kafka://10.0.0.0.1:9092/buildlogs, kafka://10.0.0.0.2:9092/buildlogs, kafka://10.0.0.0.3:9092/buildlogs)` Note that over `http` and `https` logs are streamed, meaning the connection is held open and as logs are produced the are flushed.  This requires an end point that can maintain more of a socket `chunked` http connection. The log data is not structured but raw text.

```
POST /:app_id/:build_id
{
  "webhooks":{
    "status":"https://token@example.com",
    "logs":["https://user:pass@example.com","kafka://10.0.0.1:9092/buildlogs"],
  },
  "metadata":"deploymentt-namespacce",
  "human_readable_info":"Build #3 - https://example.com/repo.git sha #abcdef134",
  "arguments":{"X":"Y"},
  "source":{
    "url":"docker://user:pass@example.com/org/repo:tag",
  },
  "destination":{
    "url":"docker://user:pass@example.com/org/repo:tag",
  },
}
```

The `source.url` and `destionation.url` are used to specify what to build and where to push it to. The `source.url` supports `http`, `https` and `docker`. The `destionation.url` only supports `docker` scheme. The `metadata` field is passed back to the `status` and `logs` webhooks. This can be any data to help identify information coming back. The `arguments` field are build environment variables that should be added during the build process. These are merged with the `EXTRA_BUILD_ARGS` config setting and passed into the build.

### Status Webhook

```
POST
{
  "id":".. metadata ..",
  "type":"build system",
  "building":"true/false",
  "status":"pending|queued|timedout|failed|succeeded"
}
```

### Responses

**200** OK

```
{
    "status":"OK"
}
```

**400** Required field missing

## Stopping a build

### Request

```
DELETE /:app_id/:build_id
```

### Response

**200** OK

```
{
    "status":"OK"
}
```

**422** The build is not running







# Akkeris Build Shuttle

The build shuttle is a private API used by the app controller to cache builds and abstract out jenkins from the main code body of the app controller. 

Requires a jenkins build server with a service account, in addition the jenkins instance must have a user named `akkeris-build-bot` capable of writing to the DOCKER_REGISTRY_HOST and DOCKER_REPO environment variables set in the app controller.

**NEVER:** Hit these API end points on this directly! 

## Environment Vars:

* `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_LOCATION` - Amazon S3 service to use to store build sources
* `JENKINS_URL` - The backing jenkins instance to use, must have pipeline extensions enabled.
* `BUILD_SHUTTLE_HOST` - The host of the alamo build shuttle.
* `PORT` - The port to listen on

## Starting:

npm start

## Testing

You'll need to set the additional environment variables for running tests:

1. TEST_GM_REGISTRY_HOST - This is the docker private image registry hostname where gold master images are stored.
2. TEST_GM_REGISTRY_REPO - This is the name of the org (not repo) that should be used for gold master images.
3. NGROK_TOKEN - In order to hear callbacks, a NGROK token is necessary, see www.ngrok.com for more information.
4. CODACY_PROJECT_TOKEN - to report code coverage set this token, otherwise reports are produced locally.
5. TEST_MODE=true - Set to true always.

```
npm test
```


## API End points:

`POST /` - PRIVATE

With payload:

```
{
  sha, 
  app,
  space, 
  branch, 
  repo, 
  org, 
  callback,
  callback_auth,
  build_uuid, 
  app_uuid, 
  sources, 
  build_opts, 
  docker_registry, 
  docker_login, 
  docker_password
}
```

This will trigger a build in jenkins, note bad things happen if you have not setup the following preconditions:

1. Ensure that no build is currently running of the same job.
2. Ensure the job has been created. 
3. Ensured that the build uuid is unique in the postrges app controller db.

The only system that should hit this is the alamo app controller!

`GET /{build_uuid}` - PRIVATE

This will return the payload sources, this is only fetched by jenkins and should not be relied upon by any other system.  Once again private!

`DELETE /{app_name}-{app_uuid}/{build_foreign_key}` - PRIVATE - Stops a build
`DELETE /{app_name}-{app_uuid}` - PRIVATE - Deletes the job
`GET /{app_name}-{app_uuid}/{build_foriegn_key}/status` - PRIVATE - gets the job status `{"building":false, "status":"pending|failed|stopped|succeeded}, "type":"jenkins", "id":1}`
`GET /{app_name}-{app_uuid}/{build_foriegn_key}/logs` - PRIVATE - Gets the logs for the build.

