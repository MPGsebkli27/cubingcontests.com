'use client';

import { Role } from '~/shared_helpers/enums';
import AuthorizedLayout from '@c/adminAndModerator/AuthorizedLayout';

const ModLayout = ({ children }: { children: React.ReactNode }) => {
  return <AuthorizedLayout role={Role.Moderator}>{children}</AuthorizedLayout>;
};

export default ModLayout;