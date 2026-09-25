// Application scope belongs to the shared Platform foundation.
module.exports = {
  getAppType: (...args) => require("../services/appType.service").getAppType(...args)
};
