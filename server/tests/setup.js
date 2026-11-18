// Tests run against a dedicated database: TEST_DATABASE_URL (falls back to DATABASE_URL + "_test").
import dotenv from "dotenv";

dotenv.config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-secret";
process.env.ADMIN_SIGNUP_CODE = "TEST-ADMIN-CODE";
process.env.OSRM_URL = "http://127.0.0.1:9"; // force offline straight-line routing in tests
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL.replace(/\/(\w+)(\?|$)/, "/$1_test$2");
