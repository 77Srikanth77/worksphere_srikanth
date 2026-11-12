// LCA wage and case number are salary-level details: only these roles (and the employee themselves) see them.
const LCA_ROLES = ['ADMIN', 'CEO', 'HR', 'LEGAL'];
const LCA_FIELDS = ['lca_case_number', 'lca_wage_cents', 'lca_wage_unit'];

/** Removes LCA fields from a work row unless the viewer may see them */
function redactWork(row, role) {
  if (!row || LCA_ROLES.includes(role) || role === 'EMPLOYEE') return row;
  const out = { ...row };
  LCA_FIELDS.forEach((f) => delete out[f]);
  return out;
}

module.exports = { LCA_ROLES, redactWork };
