import fs from 'node:fs';
import path from 'node:path';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import { VueLoaderPlugin } from 'vue-loader';
import webpack from 'webpack';

const root = import.meta.dirname;
const extensionName = 'preset-easy-toggle-extension';
const extensionSourceDir = path.join(root, 'src', 'extension', 'preset-control');
const outDir = path.join(root, 'dist', extensionName);

class CopyManifestPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyManifestPlugin', () => {
      fs.mkdirSync(outDir, { recursive: true });
      const sourcePath = path.join(extensionSourceDir, 'manifest.json');
      const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

      fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(source, null, 2)}\n`);
      fs.writeFileSync(
        path.join(root, 'manifest.json'),
        `${JSON.stringify({ ...source, js: `dist/${extensionName}/index.js` }, null, 2)}\n`,
      );
    });
  }
}

export default {
  experiments: {
    outputModule: true,
  },
  devtool: false,
  entry: path.join(extensionSourceDir, 'index.ts'),
  target: 'browserslist',
  output: {
    filename: 'index.js',
    path: outDir,
    publicPath: '',
    library: { type: 'module' },
    clean: true,
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
    new CopyManifestPlugin(),
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
