import { UserRoleEnum } from '../enums/user-role.enum';

export interface JwtPayload {
  user_id: string;
  role: UserRoleEnum;
  is_admin: boolean;
  session_id: string;
  iat: number;
  exp: number;
}
