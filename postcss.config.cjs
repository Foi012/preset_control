/** @type {import('postcss-load-config').Config} */
const config = {
  // Components use standard CSS; the native bundle no longer uses Tailwind.
  // Do not require packages removed from package.json with the old scaffold.
  plugins: [],
};

module.exports = config;

