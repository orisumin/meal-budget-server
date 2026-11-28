# Meal Budget API Server

## Purpose

This server is the middle layer between client applications and MongoDB Atlas.

```text
JavaScript frontend ──┐
                       ├──> deployed API server ───> MongoDB Atlas
C# application ───────┘
```

The frontend and C# application are API clients. They request JSON from the
server. They do not connect directly to MongoDB Atlas and must never receive
the MongoDB connection string.

## Responsibilities

- Provide JSON HTTP endpoints for users, weeks, and recipes.
- Support CRUD operations through `/api/users`, `/api/weeks`, and
  `/api/recipes`.
- Validate input before writing to MongoDB.
- Remove password hashes from user responses.
- Provide `/api/health` for deployment checks.
- Provide the place for future complex actions such as
  `POST /api/meal-plans/generate` or `POST /api/budget/calculate`.

## File responsibilities

- `server.js`: startup, environment variables, MongoDB connection, indexes,
  and listening on the deployment port.
- `app.js`: Express middleware, CORS, routes, MongoDB operations, and JSON
  error responses.
- `validation.js`: request-body validation. Copy the existing project version
  into this bundle when deploying.
- `package.json`: start, development, and test commands.
- `.env.example`: names of required environment variables without secrets.

## Request flow

```text
Client request
  -> Express middleware and CORS checks
  -> route handler
  -> validation
  -> MongoDB operation or business service
  -> JSON response
```

The JavaScript frontend uses the deployed API URL with browser requests. The
C# application uses the same URL with an HTTP client and converts the JSON
response into C# objects. C# does not need browser CORS permission; browsers
do.

## Deployment requirements

- Use `npm start` as the start command.
- Set `MONGODB_URI` in the deployment provider's secret environment settings.
- Set `MONGODB_DB` to the Atlas database name.
- The server listens on `0.0.0.0` and uses the provider's `PORT` value.
- Configure Atlas Network Access so the deployed service can connect.
- Set `ALLOWED_HOSTS` to the deployed API hostname.
- Set `ALLOWED_ORIGINS` to the deployed frontend origin.
- Test `GET /api/health` after deployment.

## Security rules

- Never commit `.env`, database passwords, tokens, or private keys.
- CORS is not authentication. Add authentication and authorization before
  exposing private user data or destructive operations publicly.
- Use HTTPS for the deployed API and clients.
- Use a restricted MongoDB database user, not an administrator account.

## Collaboration context

The API is the shared communication layer for the JavaScript frontend and C#
application. The clients only need the public API base URL and the documented
JSON contract. A shared repository is optional; deployment makes the API
reachable from other devices.
