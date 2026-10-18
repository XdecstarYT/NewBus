import { z } from 'zod';
import { createStaffSchema, updateStaffSchema } from '@dw/shared';
import { registerGameRoutes } from './game';
import { h, parse, ctx, companyOf, requireModule, requireRole } from './http';
import { listStaff, createStaff, updateStaff } from '../services/staff';
import { getCompanyPermissions } from '../permissions';
import { Router } from 'express';

/** Company Settings -> Staff management (company admins only, module "staff"). */
export function registerStaffRoutes() {
  registerGameRoutes((r) => {
    const s = Router();
    s.use(requireModule('staff'), requireRole('COMPANY_ADMIN', 'OWNER'));
    s.get('/', h((req) => ({ staff: listStaff(companyOf(req)), grantable: getCompanyPermissions(companyOf(req)).limits.staffGrantable.filter((m) => getCompanyPermissions(companyOf(req)).modules[m]), limits: { canCreateStaff: getCompanyPermissions(companyOf(req)).limits.canCreateStaff, maxStaff: getCompanyPermissions(companyOf(req)).limits.maxStaff } })));
    s.post('/', h((req) => createStaff(companyOf(req), ctx(req).account.id, parse(createStaffSchema, req.body))));
    s.patch('/:id', h((req) => updateStaff(companyOf(req), req.params.id, ctx(req).account.id, parse(updateStaffSchema, req.body))));
    r.use('/staff', s);
    void z;
  });
}
