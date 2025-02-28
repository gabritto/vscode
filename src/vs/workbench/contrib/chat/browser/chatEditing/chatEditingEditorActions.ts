/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ICodeEditor, isCodeEditor, isDiffEditor } from '../../../../../editor/browser/editorBrowser.js';
import { localize, localize2 } from '../../../../../nls.js';
import { EditorAction2, ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { CHAT_CATEGORY } from '../actions/chatActions.js';
import { ChatEditorController, ctxHasEditorModification, ctxReviewModeEnabled } from './chatEditingEditorController.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import { CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME, IChatEditingService, IChatEditingSession, IModifiedFileEntry } from '../../common/chatEditingService.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { getNotebookEditorFromEditorPane } from '../../../notebook/browser/notebookBrowser.js';
import { ctxNotebookHasEditorModification } from '../../../notebook/browser/contrib/chatEdit/notebookChatEditContext.js';
import { resolveCommandsContext } from '../../../../browser/parts/editor/editorCommandsContext.js';
import { IListService } from '../../../../../platform/list/browser/listService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { MultiDiffEditorInput } from '../../../multiDiffEditor/browser/multiDiffEditorInput.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';

abstract class NavigateAction extends Action2 {

	constructor(readonly next: boolean) {
		super({
			id: next
				? 'chatEditor.action.navigateNext'
				: 'chatEditor.action.navigatePrevious',
			title: next
				? localize2('next', 'Go to Next Chat Edit')
				: localize2('prev', 'Go to Previous Chat Edit'),
			category: CHAT_CATEGORY,
			icon: next ? Codicon.arrowDown : Codicon.arrowUp,
			keybinding: {
				primary: next
					? KeyMod.Alt | KeyCode.F5
					: KeyMod.Alt | KeyMod.Shift | KeyCode.F5,
				weight: KeybindingWeight.WorkbenchContrib,
				when: ContextKeyExpr.and(
					ContextKeyExpr.or(ctxHasEditorModification, ctxNotebookHasEditorModification),
					EditorContextKeys.focus
				),
			},
			f1: true,
			menu: {
				id: MenuId.ChatEditingEditorContent,
				group: 'navigate',
				order: !next ? 2 : 3,
				when: ctxReviewModeEnabled
			}
		});
	}

	override async run(accessor: ServicesAccessor) {

		const instaService = accessor.get(IInstantiationService);
		const chatEditingService = accessor.get(IChatEditingService);
		const editorService = accessor.get(IEditorService);

		let editor = editorService.activeTextEditorControl;
		if (isDiffEditor(editor)) {
			editor = editor.getModifiedEditor();
		}
		if (!isCodeEditor(editor) || !editor.hasModel()) {
			return;
		}
		const ctrl = ChatEditorController.get(editor);
		if (!ctrl) {
			return;
		}

		const session = chatEditingService.editingSessionsObs.get()
			.find(candidate => candidate.getEntry(editor.getModel().uri));

		if (!session) {
			return;
		}

		const done = this.next
			? ctrl.revealNext(true)
			: ctrl.revealPrevious(true);

		if (done) {
			return;
		}

		const didOpenNext = await instaService.invokeFunction(openNextOrPreviousChange, session, session.getEntry(editor.getModel().uri)!, this.next);
		if (!didOpenNext) {
			// wrap inside the same file
			if (this.next) {
				ctrl.revealNext(false);
			} else {
				ctrl.revealPrevious(false);
			}
		}
	}
}

async function openNextOrPreviousChange(accessor: ServicesAccessor, session: IChatEditingSession, entry: IModifiedFileEntry, next: boolean) {

	const editorService = accessor.get(IEditorService);

	const entries = session.entries.get();
	const idx = entries.indexOf(entry);
	const newIdx = (idx + (next ? 1 : -1) + entries.length) % entries.length;
	if (idx === newIdx) {
		return false;
	}

	entry = entries[newIdx];
	const change = entry.diffInfo.get().changes.at(next ? 0 : -1);

	const newEditorPane = await editorService.openEditor({
		resource: entry.modifiedURI,
		options: {
			selection: change && Range.fromPositions({ lineNumber: change.modified.startLineNumber, column: 1 }),
			revealIfOpened: false,
			revealIfVisible: false,
		}
	}, ACTIVE_GROUP);


	const newEditor = newEditorPane?.getControl();
	if (isCodeEditor(newEditor)) {
		ChatEditorController.get(newEditor)?.initNavigation();
	}
	return true;
}

abstract class AcceptDiscardAction extends Action2 {

	constructor(id: string, readonly accept: boolean) {
		super({
			id,
			title: accept
				? localize2('accept', 'Accept Chat Edit')
				: localize2('discard', 'Discard Chat Edit'),
			shortTitle: accept
				? localize2('accept2', 'Accept')
				: localize2('discard2', 'Discard'),
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(ctxHasEditorModification),
			icon: accept
				? Codicon.check
				: Codicon.discard,
			f1: true,
			keybinding: {
				when: EditorContextKeys.focus,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: accept
					? KeyMod.CtrlCmd | KeyCode.Enter
					: KeyMod.CtrlCmd | KeyCode.Backspace
			},
			menu: {
				id: MenuId.ChatEditingEditorContent,
				group: 'a_resolve',
				order: accept ? 0 : 1,
				when: !accept ? ctxReviewModeEnabled : undefined
			}
		});
	}

	override async run(accessor: ServicesAccessor) {
		const instaService = accessor.get(IInstantiationService);
		const chatEditingService = accessor.get(IChatEditingService);
		const editorService = accessor.get(IEditorService);

		const sessions = chatEditingService.editingSessionsObs.get();

		let uri = getNotebookEditorFromEditorPane(editorService.activeEditorPane)?.textModel?.uri;
		if (uri && !sessions.some(candidate => candidate.getEntry(uri!))) {
			// Look for a session associated with the active cell editor. E.g. inlinechat
			uri = undefined;
		}
		if (!uri) {
			let editor = editorService.activeTextEditorControl;
			if (isDiffEditor(editor)) {
				editor = editor.getModifiedEditor();
			}
			uri = isCodeEditor(editor) && editor.hasModel()
				? editor.getModel().uri
				: undefined;
		}
		if (!uri) {
			return;
		}

		let entry: IModifiedFileEntry | undefined;
		let session: IChatEditingSession | undefined;

		for (const candidateSession of sessions) {
			const candidateEntry = candidateSession.getEntry(uri);
			if (candidateEntry) {
				entry = candidateEntry;
				session = candidateSession;
				break;
			}
		}

		if (!session || !entry) {
			return;
		}

		if (this.accept) {
			session.accept(uri);
		} else {
			session.reject(uri);
		}

		await instaService.invokeFunction(openNextOrPreviousChange, session, entry, true);
	}
}

export class AcceptAction extends AcceptDiscardAction {

	static readonly ID = 'chatEditor.action.accept';

	constructor() {
		super(AcceptAction.ID, true);
	}
}

export class RejectAction extends AcceptDiscardAction {

	static readonly ID = 'chatEditor.action.reject';

	constructor() {
		super(RejectAction.ID, false);
	}
}

class RejectHunkAction extends EditorAction2 {
	constructor() {
		super({
			id: 'chatEditor.action.undoHunk',
			title: localize2('undo', 'Discard this Change'),
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(ctxHasEditorModification, ChatContextKeys.requestInProgress.negate()),
			icon: Codicon.discard,
			f1: true,
			keybinding: {
				when: EditorContextKeys.focus,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backspace
			},
			menu: {
				id: MenuId.ChatEditingEditorHunk,
				order: 1
			}
		});
	}

	override runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor, ...args: any[]) {
		ChatEditorController.get(editor)?.rejectNearestChange(args[0]);
	}
}

class AcceptHunkAction extends EditorAction2 {
	constructor() {
		super({
			id: 'chatEditor.action.acceptHunk',
			title: localize2('acceptHunk', 'Accept this Change'),
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(ctxHasEditorModification, ChatContextKeys.requestInProgress.negate()),
			icon: Codicon.check,
			f1: true,
			keybinding: {
				when: EditorContextKeys.focus,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			},
			menu: {
				id: MenuId.ChatEditingEditorHunk,
				order: 0
			}
		});
	}

	override runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor, ...args: any[]) {
		ChatEditorController.get(editor)?.acceptNearestChange(args[0]);
	}
}

class OpenDiffAction extends EditorAction2 {
	constructor() {
		super({
			id: 'chatEditor.action.diffHunk',
			title: localize2('diff', 'Toggle Diff Editor'),
			category: CHAT_CATEGORY,
			toggled: {
				condition: EditorContextKeys.inDiffEditor,
				icon: Codicon.goToFile,
			},
			precondition: ContextKeyExpr.and(ctxHasEditorModification, ChatContextKeys.requestInProgress.negate()),
			icon: Codicon.diffSingle,
			keybinding: {
				when: EditorContextKeys.focus,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F7,
			},
			menu: [{
				id: MenuId.ChatEditingEditorHunk,
				order: 10
			}, {
				id: MenuId.ChatEditingEditorContent,
				group: 'a_resolve',
				order: 2,
				when: ctxReviewModeEnabled
			}]
		});
	}

	override runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor, ...args: any[]) {
		ChatEditorController.get(editor)?.toggleDiff(args[0]);
	}
}

export class ReviewChangesAction extends EditorAction2 {

	constructor() {
		super({
			id: 'chatEditor.action.reviewChanges',
			title: localize2('review', "Review"),
			menu: [{
				id: MenuId.ChatEditingEditorContent,
				group: 'a_resolve',
				order: 3,
				when: ctxReviewModeEnabled.negate(),
			}]
		});
	}

	override runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor) {
		const chatEditingService = accessor.get(IChatEditingService);

		if (!editor.hasModel()) {
			return;
		}

		const session = chatEditingService.editingSessionsObs.get().find(session => session.getEntry(editor.getModel().uri));
		const entry = session?.getEntry(editor.getModel().uri);
		entry?.enableReviewModeUntilSettled();
	}
}


// --- multi file diff

abstract class MultiDiffAcceptDiscardAction extends Action2 {

	constructor(readonly accept: boolean) {
		super({
			id: accept ? 'chatEditing.multidiff.acceptAllFiles' : 'chatEditing.multidiff.discardAllFiles',
			title: accept ? localize('accept3', 'Accept All Edits') : localize('discard3', 'Discard All Edits'),
			icon: accept ? Codicon.check : Codicon.discard,
			menu: {
				when: ContextKeyExpr.equals('resourceScheme', CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME),
				id: MenuId.EditorTitle,
				order: accept ? 0 : 1,
				group: 'navigation',
			},
		});
	}

	async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const chatEditingService = accessor.get(IChatEditingService);
		const editorService = accessor.get(IEditorService);
		const editorGroupsService = accessor.get(IEditorGroupsService);
		const listService = accessor.get(IListService);

		const resolvedContext = resolveCommandsContext(args, editorService, editorGroupsService, listService);

		const groupContext = resolvedContext.groupedEditors[0];
		if (!groupContext) {
			return;
		}

		const editor = groupContext.editors[0];
		if (!(editor instanceof MultiDiffEditorInput) || !editor.resource) {
			return;
		}

		const session = chatEditingService.getEditingSession(editor.resource.authority);
		if (this.accept) {
			await session?.accept();
		} else {
			await session?.reject();
		}
	}
}


export function registerChatEditorActions() {
	registerAction2(class NextAction extends NavigateAction { constructor() { super(true); } });
	registerAction2(class PrevAction extends NavigateAction { constructor() { super(false); } });
	registerAction2(ReviewChangesAction);
	registerAction2(AcceptAction);
	registerAction2(AcceptHunkAction);
	registerAction2(RejectAction);
	registerAction2(RejectHunkAction);
	registerAction2(OpenDiffAction);

	registerAction2(class extends MultiDiffAcceptDiscardAction { constructor() { super(true); } });
	registerAction2(class extends MultiDiffAcceptDiscardAction { constructor() { super(false); } });

	MenuRegistry.appendMenuItem(MenuId.ChatEditingEditorContent, {
		command: {
			id: navigationBearingFakeActionId,
			title: localize('label', "Navigation Status"),
			precondition: ContextKeyExpr.false(),
		},
		group: 'navigate',
		order: -1,
		when: ctxReviewModeEnabled,
	});
}

export const navigationBearingFakeActionId = 'chatEditor.navigation.bearings';
