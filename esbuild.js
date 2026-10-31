const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: 'silent',
	plugins: [
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
	],
};

async function main() {
	// Extension host (Node) bundle
	const extensionCtx = await esbuild.context({
		...shared,
		entryPoints: ['src/extension.ts'],
		format: 'cjs',
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
	});

	// Webview (browser) bundle — React + React Flow. CSS imports are emitted
	// alongside as dist/webview/main.css.
	const webviewCtx = await esbuild.context({
		...shared,
		entryPoints: ['src/webview/main.tsx'],
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		outfile: 'dist/webview/main.js',
		jsx: 'automatic',
		define: {
			'process.env.NODE_ENV': production ? '"production"' : '"development"',
		},
	});

	const contexts = [extensionCtx, webviewCtx];
	if (watch) {
		await Promise.all(contexts.map(ctx => ctx.watch()));
	} else {
		await Promise.all(contexts.map(ctx => ctx.rebuild()));
		await Promise.all(contexts.map(ctx => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
