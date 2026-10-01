const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });
function cleanUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("Enter a valid HTTP or HTTPS endpoint.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw fail("Use an HTTP endpoint without embedded credentials.");
  url.hash = "";
  return url;
}
module.exports = { fail, cleanUrl };
