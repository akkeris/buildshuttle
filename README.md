# Akkeris Build Shuttle

The build shuttle is a private API used by the controller-api to build docker images from sources.

## Environment Vars:

* `PORT` - The port number to use to listen to new builds.
* `NO_CACHE` - Whether to cache layers as much as possible during builds. If set to `true` docker build will not cache the pull or build.
* `DOCKER_BUILD_IMAGE` - The docker image to use when spinning up worker nodes, the image defaults to `akkeris/buildshuttle:latest`
* `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_LOCATION` - Amazon S3 service to use to store build sources
* `BUILD_SHUTTLE_HOST` - The host of the alamo build shuttle.

## Starting:

npm start

## Testing

You'll need to set the additional environment variables (minus amazon s3 stuff, it'll skip that) for running tests:

* `DOCKER_LOGIN` - docker repo password to push test images
* `DOCKER_PASS` - docker repo login to push test images
* `DOCKER_HOST` - the docker host to push images, defaults to docker.io
* `DOCKER_ORG` - the docker org to push images, defaults to akkeris
* `NGROK_TOKEN` - In order to hear webhooks, a NGROK token is necessary, see www.ngrok.com for more information.
* `CODACY_PROJECT_TOKEN` - to report code coverage set this token, otherwise reports are produced locally.

```
npm test
```

## API

### Create a build

`POST /`

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
  gm_registry_host,
  gm_registry_auth,
  build_number,
  build_args, 
  docker_registry, 
  docker_login, 
  docker_password
}
```


This will trigger a build in a worker container. The `sources` field must be a uri for the sources (http, https, docker://host.com/org/repo:tag, or data uri).

### Get the build sources

`GET /{build_uuid}`

This will return the payload sources, this is only fetched by accompanying systems to resubmit builds or to examine sources.

### Deletes the build

`DELETE /{app_name}-{app_uuid}/{build_foreign_key}`

### Stops a build

`DELETE /{app_name}-{app_uuid}`

### Deletes the job

`GET /{app_name}-{app_uuid}/{build_foriegn_key}/logs`

Gets the logs for the build.

