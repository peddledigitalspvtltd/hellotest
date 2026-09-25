const service = require("../services/auth.service");

const getBearerToken = (headers) => {
  const match = /^Bearer\s+(.+)$/i.exec(headers.authorization || "");
  if (!match?.[1]?.trim()) {
    throw Object.assign(new Error("Missing bearer token"), { statusCode: 401 });
  }
  return match[1].trim();
};

module.exports = async function (fastify) {
  fastify.get("/auth/setup", async () => {
    return service.getAuthSetup();
  });

  fastify.post("/auth/signup/request-code", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password: { required: true, type: "string", minLength: 6 },
      name: { required: false, type: "string" }
    }, req.body);

    return service.requestSignupCode(req.body);
  });

  fastify.post("/auth/signup/verify", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      code: { required: true, type: "string", minLength: 6 }
    }, req.body);

    return service.verifySignupCode(req.body);
  });

  fastify.post("/auth/login", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password: { required: true, type: "string", minLength: 6 }
    }, req.body);

    return service.login(req.body);
  });

  fastify.post("/auth/login/google", async (req) => {
    fastify.validate({
      idToken: { required: true, type: "string", minLength: 10 }
    }, req.body);

    return service.loginWithGoogle(req.body);
  });

  fastify.post("/auth/forgot-password/request-code", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      newPassword: { required: true, type: "string", minLength: 6 }
    }, req.body);

    return service.requestPasswordResetCode(req.body);
  });

  fastify.post("/auth/forgot-password/verify", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      code: { required: true, type: "string", minLength: 6 }
    }, req.body);

    return service.verifyPasswordResetCode(req.body);
  });

  fastify.get("/auth/session", async (req) => {
    const token = getBearerToken(req.headers);
    return service.getSession(token);
  });
};
