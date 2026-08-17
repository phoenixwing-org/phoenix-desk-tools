import { describe, expect, it } from "vitest";
import {
  PROJECT_GITEE_HOME,
  PROJECT_GITEE_ORGANIZATION_HOME,
  PROJECT_GITEE_REPO,
  PROJECT_INSTALL_DOC,
  PROJECT_QUICKSTART_DOC,
} from "./projectLinks";

describe("Phoenix Desk Tools project links", () => {
  it("统一使用 phoenixwing 组织与 Desk Tools 仓库", () => {
    expect(PROJECT_GITEE_ORGANIZATION_HOME).toBe("https://gitee.com/phoenixwing");
    expect(PROJECT_GITEE_HOME).toBe("https://gitee.com/phoenixwing/phoenix-desk-tools");
    expect(PROJECT_GITEE_REPO).toBe("https://gitee.com/phoenixwing/phoenix-desk-tools.git");
  });

  it("指向仓库统一 docs 目录中的用户文档", () => {
    expect(PROJECT_INSTALL_DOC).toBe(
      "https://gitee.com/phoenixwing/phoenix-desk-tools/blob/master/docs/user/桌面工具-安装说明.md",
    );
    expect(PROJECT_QUICKSTART_DOC).toBe(
      "https://gitee.com/phoenixwing/phoenix-desk-tools/blob/master/docs/user/快速开始.md",
    );
  });
});
