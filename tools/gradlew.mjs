// android/의 Gradle wrapper를 OS에 맞게 실행(npm 스크립트용): node tools/gradlew.mjs assemblePlayRelease ...
// JDK는 ~/.gradle/gradle.properties의 org.gradle.java.home(21 권장 - Gradle 8.14는 JDK 25에서 안 돈다). 저장소에는 경로를 넣지 않는다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// wrapper 스크립트는 Gradle을 띄우려고 java를 먼저 찾는다(org.gradle.java.home은 그 뒤에 읽힌다) - JAVA_HOME이 없으면 같은 값을 쓴다.
function javaHomeFromGradleProps() {
  try {
    const m = readFileSync(join(homedir(), '.gradle', 'gradle.properties'), 'utf8').match(/^\s*org\.gradle\.java\.home\s*=\s*(.+?)\s*$/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}

const env = { ...process.env };
env.JAVA_HOME ||= javaHomeFromGradleProps();
const win = process.platform === 'win32';
// .bat은 shell로만 띄울 수 있다 - 경로에 공백이 있어(Gem Guardians) cwd 기준 상대 이름으로 부른다.
const r = spawnSync(win ? '.\\gradlew.bat' : './gradlew', process.argv.slice(2), { cwd: 'android', stdio: 'inherit', shell: win, env });
process.exit(r.status ?? 1);
