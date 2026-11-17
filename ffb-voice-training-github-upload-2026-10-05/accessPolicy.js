export function authorizedSetup(raw,user) {
  if(user?.role==='trainer')return {...raw,center:user.center,employeeName:user.employeeName};
  if(user?.role==='manager'&&!user.allowedCenters.includes(raw.center))throw new Error('Center access is not allowed.');
  return raw;
}
export function visibleRoster(user,roster) {
  if(user?.role==='trainer')return {[user.center]:[user.employeeName]};
  if(user?.role==='manager')return Object.fromEntries(Object.entries(roster).filter(([center])=>user.allowedCenters.includes(center)));
  return roster;
}

export function dashboardOptions(user, roster, records = []) {
  const scopedRoster = visibleRoster(user, roster);
  const visibleRecords = records.filter(record => {
    if (user?.role === 'trainer') return record.center === user.center && record.employeeName === user.employeeName;
    if (user?.role === 'manager') return user.allowedCenters.includes(record.center);
    return true;
  });
  const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    centers: unique([...Object.keys(scopedRoster), ...visibleRecords.map(record => record.center)]),
    employees: unique([...Object.values(scopedRoster).flat(), ...visibleRecords.map(record => record.employeeName)]),
  };
}
