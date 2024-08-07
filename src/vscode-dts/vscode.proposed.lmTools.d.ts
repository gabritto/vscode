/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 3
// https://github.com/microsoft/vscode/issues/213274

declare module 'vscode' {

	// TODO@API capabilities

	export type JSONSchema = object;

	// API -> LM: an tool/function that is available to the language model
	export interface LanguageModelChatFunction {
		name: string;
		description: string;
		parametersSchema?: JSONSchema;
	}

	// API -> LM: add tools as request option
	export interface LanguageModelChatRequestOptions {
		// TODO@API this will a heterogeneous array of different types of tools
		tools?: LanguageModelChatFunction[];

		/**
		 * Force a specific tool to be used.
		 */
		toolChoice?: string;
	}

	// LM -> USER: function that should be used
	export class LanguageModelChatResponseFunctionUsePart {
		name: string;
		parameters: any;

		constructor(name: string, parameters: any);
	}

	// LM -> USER: text chunk
	export class LanguageModelChatResponseTextPart {
		value: string;

		constructor(value: string);
	}

	export interface LanguageModelChatResponse {

		stream: AsyncIterable<LanguageModelChatResponseTextPart | LanguageModelChatResponseFunctionUsePart>;
	}


	// USER -> LM: the result of a function call
	export class LanguageModelChatMessageFunctionResultPart {
		name: string;
		content: string;
		isError: boolean;

		constructor(name: string, content: string, isError?: boolean);
	}

	export interface LanguageModelChatMessage {
		content2: string | LanguageModelChatMessageFunctionResultPart;
	}

	export interface LanguageModelToolResult {
		/**
		 * The result can contain arbitrary representations of the content. An example might be 'prompt-tsx' to indicate an element that can be rendered with the @vscode/prompt-tsx library.
		 */
		[contentType: string]: any;

		/**
		 * A string representation of the result which can be incorporated back into an LLM prompt without any special handling.
		 */
		toString(): string;
	}

	// Tool registration/invoking between extensions

	export namespace lm {
		/**
		 * Register a LanguageModelTool. The tool must also be registered in the package.json `languageModelTools` contribution point.
		 */
		export function registerTool(name: string, tool: LanguageModelTool): Disposable;

		/**
		 * A list of all available tools.
		 */
		export const tools: ReadonlyArray<LanguageModelToolDescription>;

		/**
		 * Invoke a tool with the given parameters.
		 * TODO@API Could request a set of contentTypes to be returned so they don't all need to be computed?
		 */
		export function invokeTool(name: string, parameters: Object, token: CancellationToken): Thenable<LanguageModelToolResult>;
	}

	// Is the same as LanguageModelChatFunction now, but could have more details in the future
	export interface LanguageModelToolDescription {
		name: string;
		description: string;
		parametersSchema?: JSONSchema;
	}

	export interface LanguageModelTool {
		// TODO@API should it be LanguageModelToolResult | string?
		invoke(parameters: any, token: CancellationToken): Thenable<LanguageModelToolResult>;
	}
}
