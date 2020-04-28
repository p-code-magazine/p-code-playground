const path = require('path');
const { ProvidePlugin } = require('webpack');

const defaults = {
  mode: 'development',
  entry: {
    'main': './client.js'
  },
  output: {
		filename: '[name].js',
    path: path.resolve(__dirname, 'public'),
  },
  plugins: [
    new ProvidePlugin({
      jQuery: 'jquery',
      $: 'jquery'
    })
  ]
};

const production = Object.assign({}, defaults, {
  mode: 'production',
  devtool: 'source-map'
});

module.exports = (env) => {
  return env.production ? production : defaults;
};
