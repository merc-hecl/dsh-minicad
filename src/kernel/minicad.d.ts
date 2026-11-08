import type { Part } from "@classcad/smlibwasm";

/**
 * MiniCAD additions to cad_build's cad argument, alongside SMLib exports.
 * Source is a plain script: function build(parameters, cad) { ... }.
 * Do not write import/export statements. Use cad.Location, cad.Axis, etc.,
 * or destructure them from cad; SMLib names are not globals.
 */
export type AssemblyMember = { id: string; name: string; shape: Part };

/** Saved exact model; null for a new model. With part supplied to cad_build,
 * current is only that member's Part and the result replaces only that member. */
export declare const current: Part | Assembly | null;

/** Independent parts in world coordinates. IDs must be nonempty and unique.
 * Every final solid must have a meaningful name. Touching parts stay separate.
 * Example: cad.assembly([{id:"base",name:"Base",shape:base},
 *   {id:"copy",name:"Base copy",shape:base.translate([0,25,0]).colored("#DC143C")}]).
 */
export declare function assembly(parts: AssemblyMember[]): Assembly;

/** A MiniCAD collection, not an SMLib Part. Boolean operations belong to each
 * member's shape. Recompose with cad.assembly after editing the members. */
export declare class Assembly {
    parts: AssemblyMember[];
    /** Look up an existing stable ID. Throws for an unknown ID. */
    part(id: string): AssemblyMember;
    /** Translate every member without merging their geometry. */
    translate(by: readonly number[]): Assembly;
    /** Rotate every member about an SMLib Axis, angle in degrees. */
    rotate(axis: import("@classcad/smlibwasm").Axis, angle: number): Assembly;
}

/** Apply cad_edit operations to an exact model without replaying old source.
 * Numeric {parameter:"name"} references use this call's parameters only.
 * For standard operations and copying a standalone model, prefer cad_edit. */
export declare function edit(shape: Part | Assembly | null, operations: object[], parameters?: Record<string, unknown>): Part | Assembly;

/** Record an actual intermediate model with a concise label in the user's
 * language. Returns the supplied model. No extra stages are needed for a simple edit. */
export declare function checkpoint<T extends Part | Assembly>(shape: T, label?: string): T;

/** Read and archive a design-relative exact SMP, SMB or STEP resource. */
export declare function readModel(file: string): Part | Assembly;

/** Append diagnostics to this modeling execution; available as cad.log. */
export declare function log(...values: unknown[]): void;
