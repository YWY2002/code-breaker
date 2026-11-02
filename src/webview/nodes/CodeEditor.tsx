import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import type { ColorMode } from '@xyflow/react';

interface CodeEditorProps {
	value: string;
	/** VS Code language id (e.g. "python"); used to pick the grammar. */
	language?: string;
	/** Fallback for grammar lookup when the language id is unknown. */
	filename?: string;
	colorMode: ColorMode;
	onChange: (value: string) => void;
	onSave: () => void;
	className?: string;
}

/**
 * VS Code language ids that don't match a @codemirror/language-data name or
 * alias directly.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
	typescriptreact: 'TSX',
	javascriptreact: 'JSX',
	csharp: 'C#',
	cpp: 'C++',
	objectivec: 'Objective-C',
	shellscript: 'Shell',
	jsonc: 'JSON',
	dockerfile: 'Dockerfile',
	plaintext: '',
};

function findLanguage(language?: string, filename?: string): LanguageDescription | null {
	if (language) {
		const name = LANGUAGE_ALIASES[language] ?? language;
		if (name === '') {
			return null;
		}
		const byName = LanguageDescription.matchLanguageName(languages, name, true);
		if (byName) {
			return byName;
		}
	}
	return filename ? LanguageDescription.matchFilename(languages, filename) : null;
}

/** Layout tweaks on top of the VS Code theme; colours come from the theme. */
const baseTheme = EditorView.theme({
	'&': { height: '100%', fontSize: 'var(--vscode-editor-font-size, 13px)' },
	'.cm-scroller': {
		fontFamily: 'var(--vscode-editor-font-family, monospace)',
		lineHeight: '1.45',
	},
	'&.cm-focused': { outline: 'none' },
});

/**
 * Thin React wrapper around a CodeMirror 6 EditorView. The view is created
 * once; language and theme are swapped through compartments, and external
 * `value` changes are applied as a document replace.
 */
export function CodeEditor({
	value,
	language,
	filename,
	colorMode,
	onChange,
	onSave,
	className,
}: CodeEditorProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const compartments = useRef({ language: new Compartment(), theme: new Compartment() });

	// Keep callbacks current without re-registering extensions.
	const onChangeRef = useRef(onChange);
	const onSaveRef = useRef(onSave);
	onChangeRef.current = onChange;
	onSaveRef.current = onSave;

	// Create the editor once.
	useEffect(() => {
		if (!host.current) {
			return;
		}
		const { language: languageCompartment, theme: themeCompartment } = compartments.current;

		const extensions: Extension[] = [
			basicSetup,
			keymap.of([
				{
					key: 'Mod-s',
					run: () => {
						onSaveRef.current();
						return true;
					},
				},
				indentWithTab,
			]),
			baseTheme,
			themeCompartment.of(colorMode === 'light' ? vscodeLight : vscodeDark),
			languageCompartment.of([]),
			EditorView.updateListener.of(update => {
				if (update.docChanged) {
					onChangeRef.current(update.state.doc.toString());
				}
			}),
		];

		const editor = new EditorView({
			state: EditorState.create({ doc: value, extensions }),
			parent: host.current,
		});
		view.current = editor;

		return () => {
			editor.destroy();
			view.current = null;
		};
		// Mount-only: value/colorMode are synced by the effects below.
	}, []);

	// External value changes (save confirmed, file re-opened).
	useEffect(() => {
		const editor = view.current;
		if (!editor) {
			return;
		}
		const current = editor.state.doc.toString();
		if (current !== value) {
			editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
		}
	}, [value]);

	// Theme follows VS Code's light/dark class.
	useEffect(() => {
		view.current?.dispatch({
			effects: compartments.current.theme.reconfigure(colorMode === 'light' ? vscodeLight : vscodeDark),
		});
	}, [colorMode]);

	// Grammar is loaded lazily per language.
	useEffect(() => {
		const description = findLanguage(language, filename);
		if (!description) {
			view.current?.dispatch({ effects: compartments.current.language.reconfigure([]) });
			return;
		}
		let cancelled = false;
		void description.load().then(support => {
			if (!cancelled) {
				view.current?.dispatch({ effects: compartments.current.language.reconfigure(support) });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [language, filename]);

	return <div ref={host} className={className} />;
}
