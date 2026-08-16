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
