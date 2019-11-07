const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const {
  REQUEST_PROPERTIES,
  RESPONSE_PROPERTIES,
  doesPropertyMatch,
  useResponseProperties
} = require('./properties')
const {
  removeFixture,
  removeFixtures,
  registerFixture,
  getFixtureIterator
} = require('./fixtures')

function resError (res, status, message) {
  return res
    .status(status)
    .send({ message: `[FIXTURE SERVER ERROR ${status}]: ${message}` })
}

function badRequest (res, message) {
  return resError(res, 400, message)
}

function createConfiguration () {
  return {
    paths: {},
    methods: {},
    headers: {},
    query: {},
    cookies: {}
  }
}

function createServer () {
  const app = express()
  const server = require('http').createServer(app)

  app.use(bodyParser.json())
  app.use(cookieParser())

  let configuration = createConfiguration()

  app.post('/___fixtures', (fixtureReq, fixtureRes) => {
    const unsafeFixture = fixtureReq.body
    const { error, status, fixtureId } = registerFixture(
      unsafeFixture,
      configuration
    )

    if (error) {
      return resError(fixtureRes, status, error)
    }

    fixtureRes.status(201).send({ id: fixtureId })
  })

  app.post('/___fixtures/bulk', (fixtureReq, fixtureRes) => {
    const fixtures = fixtureReq.body
    const fixtureIds = []

    for (const unsafeFixture of fixtures) {
      const { error, status, fixtureId } = registerFixture(
        unsafeFixture,
        configuration
      )

      if (error) {
        for (const fixtureId of fixtureIds) {
          removeFixture(fixtureId)
        }

        return resError(fixtureRes, status, error)
      }

      fixtureIds.push(fixtureId)
    }

    fixtureRes.status(201).send(fixtureIds.map(id => ({ id })))
  })

  app.delete('/___fixtures', (req, res) => {
    removeFixtures()
    res.status(204).send({})
  })

  app.delete('/___fixtures/:id', (req, res) => {
    if (removeFixture(req.params.id)) {
      res.status(204).send({})
    } else {
      resError(res, 404, 'Fixture not found.')
    }
  })

  app.get('/___config', (req, res) => {
    res.status(200).send(configuration)
  })

  app.put('/___config', (req, res) => {
    const {
      paths = {},
      methods = {},
      headers = {},
      query = {},
      cookies = {}
    } = req.body

    if (
      typeof paths !== 'object' ||
      typeof methods !== 'object' ||
      typeof headers !== 'object' ||
      typeof query !== 'object' ||
      typeof cookies !== 'object'
    ) {
      return badRequest(res, 'Wrong configuration format.')
    }

    configuration = {
      paths,
      methods,
      headers,
      query,
      cookies
    }

    res.status(200).send(configuration)
  })

  app.delete('/___config', (req, res) => {
    configuration = createConfiguration()
    res.status(204).send()
  })

  app.use(async function fixtureHandler (req, res, next) {
    // eslint-disable-next-line no-labels
    fixtureLoop: for (const [, fixture] of getFixtureIterator()) {
      const { request, response, options = {} } = fixture

      if (
        (req.path !== request.path && request.path !== '*') ||
        req.method !== request.method
      ) {
        continue
      }

      for (const property of REQUEST_PROPERTIES) {
        const propertyOption = options.request
          ? options.request[property]
          : undefined

        if (!doesPropertyMatch(req, request, property, propertyOption)) {
          // eslint-disable-next-line no-labels
          continue fixtureLoop
        }
      }

      if (response.delay) {
        await new Promise(resolve => setTimeout(resolve, response.delay))
      }

      res.status(response.status || 200)

      // Loop over RESPONSE_PROPERTIES which has the right order
      // avoiding "Can't set headers after they are sent"
      for (const property of RESPONSE_PROPERTIES) {
        if (response[property] !== undefined) {
          useResponseProperties[property](req, res, response[property])
        }
      }

      return
    }

    next()
  })

  server.on('close', () => {
    removeFixtures()
  })

  return server
}

module.exports = createServer