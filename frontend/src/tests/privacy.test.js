import test from 'node:test';
import assert from 'node:assert/strict';

// Helper replicate from AdminDashboard
const isPhoneProtected = (phone) => {
  if (!phone) return false;
  const str = String(phone);
  return str.includes('Telefone protegido') || str.includes('🔒');
};

test('Privacy Helper: isPhoneProtected accurately detects protected phones', () => {
  assert.equal(isPhoneProtected('Telefone protegido 🔒'), true);
  assert.equal(isPhoneProtected('Telefone protegido'), true);
  assert.equal(isPhoneProtected('🔒'), true);
  assert.equal(isPhoneProtected('11988887777'), false);
  assert.equal(isPhoneProtected('(11) 98888-7777'), false);
  assert.equal(isPhoneProtected(''), false);
  assert.equal(isPhoneProtected(null), false);
  assert.equal(isPhoneProtected(undefined), false);
});

test('Privacy UI Logic: WhatsApp link resolution and suppression', () => {
  const getWhatsAppHref = (phone) => {
    if (isPhoneProtected(phone)) return null;
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) return null;
    return `https://wa.me/55${cleanPhone}`;
  };

  assert.equal(getWhatsAppHref('Telefone protegido 🔒'), null);
  assert.equal(getWhatsAppHref('11988887777'), 'https://wa.me/5511988887777');
  assert.equal(getWhatsAppHref('(11) 98765-4321'), 'https://wa.me/5511987654321');
  assert.equal(getWhatsAppHref(''), null);
  assert.equal(getWhatsAppHref(null), null);
});

test('Privacy UI Logic: Modal actions grid columns with and without protection', () => {
  const getGridColsClass = (phone) => {
    return isPhoneProtected(phone) ? 'grid-cols-2' : 'grid-cols-4';
  };

  assert.equal(getGridColsClass('Telefone protegido 🔒'), 'grid-cols-2');
  assert.equal(getGridColsClass('11988887777'), 'grid-cols-4');
});

test('Privacy Helper: checkIsOwner accurately identifies Mariana/Owner accounts', () => {
  const checkIsOwner = (u) => {
    if (!u) return false;
    if (u.role === 'owner' || u.is_owner === true || u.is_owner === 'true') return true;
    const uname = String(u.username || '').toLowerCase();
    const uid = String(u.id || '');
    return (u.role === 'admin' && (uname === 'mari' || uname === 'mariana' || uid === '1' || uid === 'pro-1')) || uname === 'mari' || uname === 'mariana' || uid === '1';
  };

  assert.equal(checkIsOwner({ id: 1, name: 'Mariana', username: 'mari', role: 'admin' }), true);
  assert.equal(checkIsOwner({ id: 2, name: 'Mariana Silva', role: 'owner' }), true);
  assert.equal(checkIsOwner({ id: 3, name: 'Mariana', is_owner: true }), true);
  assert.equal(checkIsOwner({ id: 4, name: 'Jécia', username: 'jecia', role: 'professional' }), false);
  assert.equal(checkIsOwner({ id: 5, name: 'Admin Secundário', username: 'admin2', role: 'admin' }), false);
});

test('Privacy UI Logic: collaborator permission evaluation in settings view', () => {
  const evaluateStaffPhoneVisibility = (prof, { isOwner, authorizedPhoneViewerIds, allowAdminsViewPhone }) => {
    if (isOwner) return true;
    if (authorizedPhoneViewerIds.map(String).includes(String(prof.id))) return true;
    if (authorizedPhoneViewerIds.map(v => String(v).toLowerCase()).includes(String(prof.username || '').toLowerCase())) return true;
    if (allowAdminsViewPhone && prof.role === 'admin') return true;
    return false;
  };

  const ownerProf = { id: 1, name: 'Mariana', username: 'mari', role: 'admin' };
  const colabProf1 = { id: 3, name: 'Jécia', username: 'jecia', role: 'professional' };
  const colabProf2 = { id: 4, name: 'Paula', username: 'paula', role: 'professional' };

  // Case A: Default deny
  assert.equal(evaluateStaffPhoneVisibility(ownerProf, { isOwner: true, authorizedPhoneViewerIds: [], allowAdminsViewPhone: false }), true);
  assert.equal(evaluateStaffPhoneVisibility(colabProf1, { isOwner: false, authorizedPhoneViewerIds: [], allowAdminsViewPhone: false }), false);
  assert.equal(evaluateStaffPhoneVisibility(colabProf2, { isOwner: false, authorizedPhoneViewerIds: [], allowAdminsViewPhone: false }), false);

  // Case B: Explicit authorization for colabProf1 (id 3)
  assert.equal(evaluateStaffPhoneVisibility(colabProf1, { isOwner: false, authorizedPhoneViewerIds: ['3'], allowAdminsViewPhone: false }), true);
  assert.equal(evaluateStaffPhoneVisibility(colabProf2, { isOwner: false, authorizedPhoneViewerIds: ['3'], allowAdminsViewPhone: false }), false);
});

