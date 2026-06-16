import path from 'node:path';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import { VueLoaderPlugin } from 'vue-loader';
import webpack from 'webpack';

const root = import.meta.dirname;

export default {
  experiments: {
    outputModule: true,
  },
  devtool: false,
  // The whole app (Vue UI + native mount) lives under src/preset-easy-toggle.
  entry: path.join(root, 'src', 'preset-easy-toggle', 'native.ts'),
  target: 'browserslist',
  output: {
    // SillyTavern clones this repo as the extension folder and loads the file
    // named by manifest.json ("index.js") from the repo root — so we emit there.
    filename: 'index.js',
    path: root,
    publicPath: '',
    library: { type: 'module' },
    // Never clean: the output dir is the repo root.
    clean: false,
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        use: 'vue-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
          onlyCompileBundledFiles: true,
          compilerOptions: {
            noUnusedLocals: false,
            noUnusedParameters: false,
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', { loader: 'css-loader', options: { url: false } }, 'postcss-loader'],
        exclude: /node_modules/,
      },
      {
        test: /\.(sa|sc)ss$/,
        use: ['style-loader', { loader: 'css-loader', options: { url: false } }, 'postcss-loader', 'sass-loader'],
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.vue', '.css'],
    plugins: [
      new TsconfigPathsPlugin({
        extensions: ['.ts', '.js', '.vue'],
        configFile: path.join(root, 'tsconfig.json'),
      }),
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new webpack.DefinePlugin({
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    }),
  ],
  optimization: {
    concatenateModules: false,
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {
          format: { quote_style: 1 },
          mangle: { reserved: ['toastr', '$'] },
        },
      }),
    ],
    splitChunks: false,
  },
};
