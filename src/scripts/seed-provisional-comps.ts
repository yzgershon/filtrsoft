/** Historical fake-price seeding is retired. Synthetic prices belong in the
 * isolated test fixtures, never a live database. Existing rows are recoverably
 * excluded by quarantined_comp_history, not deleted.
 */
throw new Error("Provisional comp seeding is disabled. Use isolated test fixtures; no database changed.");
