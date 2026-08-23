const nodemailer = require("nodemailer");
const integrationService = require("./integration.service");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeSenderName = (value) => /^hellotest(?: support)?$/i.test(String(value || "").trim())
  ? "HelloTest Support"
  : String(value || "").trim() || "HelloTest Support";

const resolveEmailIntegration = async () => {
  const integration = await integrationService.getActiveIntegrationByType("email");

  if (!integration) {
    throw createError(
      "Email verification is not configured yet. Add an active Email Sender integration in Administration > Integrations.",
      503
    );
  }

  const config = integration.config || {};

  if (!integration.username || !config.host || !config.port || !config.password) {
    throw createError(
      "The active Email Sender integration is incomplete. Add SMTP host, port, username, and password.",
      503
    );
  }

  return {
    integration,
    config
  };
};

exports.getEmailSenderProfile = async () => {
  try {
    const { config } = await resolveEmailIntegration();

    return {
      enabled: true,
      senderEmail: config.sender_email || "support@qualipal.in",
      senderName: normalizeSenderName(config.sender_name)
    };
  } catch (error) {
    if (error.statusCode === 503) {
      return {
        enabled: false,
        senderEmail: null,
        senderName: null
      };
    }

    throw error;
  }
};

exports.sendMail = async ({ to, subject, text, html, attachments }) => {
  const { integration, config } = await resolveEmailIntegration();

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: Boolean(config.secure),
    auth: {
      user: integration.username,
      pass: config.password
    }
  });

  await transporter.sendMail({
    from: {
      address: config.sender_email || "support@qualipal.in",
      name: normalizeSenderName(config.sender_name)
    },
    replyTo: config.sender_email || "support@qualipal.in",
    to,
    subject,
    text,
    html,
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {})
  });

  return { sent: true };
};
