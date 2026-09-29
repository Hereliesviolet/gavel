import { CredentialsSignin } from "next-auth";
import { AUTH_UNAVAILABLE_CODE, TWO_FACTOR_REQUIRED_CODE } from "@/lib/auth-codes";

export class TwoFactorRequiredError extends CredentialsSignin {
  code = TWO_FACTOR_REQUIRED_CODE;
}

export class AuthUnavailableError extends CredentialsSignin {
  code = AUTH_UNAVAILABLE_CODE;
}
