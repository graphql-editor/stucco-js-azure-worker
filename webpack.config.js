var TerserPlugin = require('terser-webpack-plugin');
var StringReplacePlugin = require("string-replace-webpack-plugin");
var path = require("path")

// replace require(expression) with __non_webpack_require__(expression)
var dynamicRequire = {
	pattern: /require\(([a-zA-Z0-9_\.]+)\)/,
	replacement: function (match, p1, offset, string) {
		console.log(`dynamic require ${p1} in ${match}`);
		return `__non_webpack_require__(${p1})`;
	}
}

module.exports = {
	entry: {
		"worker-bundle": "./src/Worker.ts",
		"dist/src/nodejsWorker": "./src/nodejsWorker.ts",
	},
	output: {
		path: `${__dirname}/pkg`,
		filename: "[name].js",
		library: "worker",
		libraryTarget: "commonjs2"
	},
	resolve: {
		// Add '.ts' and '.tsx' as a resolvable extension.
		extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"]
	},
	target: 'node',
	node: {
		__dirname: false
	},
	externals: [
		'memcpy',
	],
	module: {
		rules: [
			{
				test: /.*stucco-js.*handler.*index\.js$/,
				loader: StringReplacePlugin.replace(
					{
						replacements: [
							{
								pattern: /__importStar\(require/,
								replacement: function (match, p1, offset, string) {
									return "__importStar(__non_webpack_require__";
								}
							}
						]
					}
				)
			},
			{ 
				test: /\.tsx?$/,
				loader: "ts-loader",
				exclude: [path.resolve(__dirname, 'src/nodejsWorker.ts')],
			},
			{
				include: [path.resolve(__dirname, 'src/nodejsWorker.ts')],
				use: [
					{
						loader: StringReplacePlugin.replace({
							replacements: [
								{
									pattern: /require\(([a-zA-Z0-9_\.\/"-]+)\)/g,
									replacement: function (match, p1, offset, string) {
										return `__non_webpack_require__(${p1})`;
									}
								}
							]
						})
					},
					{ loader: "ts-loader" }
				]
			},
			{
				// supply modified grpc package.json location
				test: /.*grpc_extension.js$/,
				loader: StringReplacePlugin.replace({
					replacements: [
						dynamicRequire,
						{
							pattern: /(\.\.\/)*package.json/,
							replacement: function (match, p1, offset, string) {
								return "./grpc/package.json";
							}
						}
					]
				})
			},
			{
				// supply modified root.pem location
				test: /.*grpc.*index.js$/,
				loader: StringReplacePlugin.replace({
					replacements: [
						{
							pattern: /'\.\.', '\.\.'/,
							replacement: function (match, p1, offset, string) {
								return `'grpc'`;
							}
						}
					]
				})
			},
			{
				// use dynamic require for require(expression)
				// versioning.js -> require(env variable)
				// pre-binding.js -> require(package_json_path)
				test: /.(versioning.js|pre-binding.js)$/,
				loader: StringReplacePlugin.replace({
					replacements: [ dynamicRequire ]
				})
			}
		]
	},
	plugins: [
		new StringReplacePlugin()
	],
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				terserOptions: {
					ecma: 5,
					warnings: false,
					parse: {},
					compress: {},
					mangle: false,
					module: false,
					output: null,
					toplevel: false,
					nameCache: null,
					ie8: false,
					keep_classnames: undefined,
					keep_fnames: false,
					safari10: false,
				},
			}),
		],
	}
};
