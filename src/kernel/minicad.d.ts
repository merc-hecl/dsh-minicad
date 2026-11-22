import type { Part } from "@classcad/smlibwasm";

export type AssemblyMember = { id: string; name: string; shape: Part };

export declare const current: Part | Assembly | null;

export declare function assembly(parts: AssemblyMember[]): Assembly;

export declare class Assembly {
    parts: AssemblyMember[];
    part(id: string): AssemblyMember;
    translate(by: readonly number[]): Assembly;
    rotate(axis: import("@classcad/smlibwasm").Axis, angle: number): Assembly;
}

export declare function edit(shape: Part | Assembly | null, operations: object[], parameters?: Record<string, unknown>): Part | Assembly;

export declare function checkpoint<T extends Part | Assembly>(shape: T, label?: string): T;

export declare function readModel(file: string): Part | Assembly;

export declare function log(...values: unknown[]): void;
