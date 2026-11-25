export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Submitted values to restore after React resets the form on error. */
  values?: Record<string, string>;
};

export const initialActionState: ActionState = {};
