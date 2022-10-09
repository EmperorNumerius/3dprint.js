let editor = undefined;

// File UI ------------------------------------------------------------
const fileButton = document.querySelector('#file');
const currentElement = document.querySelector('#current');
const arrow = document.querySelector('.uparrow');
const dropdown = document.querySelector('.dropdown');

const hideDropdown = function () {
  dropdown.classList.remove('show');
  arrow.classList.remove('down');
};
const toggleDropdown = function (event) {
  event.stopPropagation();
  dropdown.classList.toggle('show');
  arrow.classList.toggle('down');
};
fileButton.onclick = toggleDropdown;
document.body.onclick = hideDropdown;

const prefix = 'ManifoldCAD';
function getScript(name) {
  return window.localStorage.getItem(prefix + name);
}
function setScript(name, code) {
  window.localStorage.setItem(prefix + name, code);
}
function removeScript(name) {
  window.localStorage.removeItem(prefix + name);
}
function nthKey(n) {
  if (n >= window.localStorage.length) return;
  const key = window.localStorage.key(n);
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
}

function saveCurrent() {
  if (editor) {
    const currentName = currentElement.textContent;
    if (!examples.get(currentName)) {
      setScript(currentName, editor.getValue());
    }
  }
};

window.onpagehide = saveCurrent;
window.beforeunload = saveCurrent;

let switching = false;
let isExample = true;
function switchTo(scriptName) {
  if (editor) {
    switching = true;
    currentElement.textContent = scriptName;
    setScript('currentName', scriptName);
    const code = examples.get(scriptName) ?? getScript(scriptName) ?? '';
    isExample = examples.get(scriptName) != null;
    editor.setValue(code);
  }
}

function appendDropdownItem(name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('blue', 'item');
  const label = document.createElement('span');
  button.appendChild(label);
  label.textContent = name;
  dropdown.appendChild(button);

  button.onclick = function () {
    saveCurrent();
    switchTo(label.textContent);
  };
  return button;
}

function addIcon(button) {
  const icon = document.createElement('button');
  icon.classList.add('icon');
  button.appendChild(icon);
  return icon;
}

function uniqueName(name) {
  let num = 1;
  let newName = name;
  while (getScript(newName) != null || examples.get(newName) != null) {
    newName = name + ' ' + num++;
  }
  return newName;
}

function addEdit(button) {
  const label = button.firstChild;
  const edit = addIcon(button);
  edit.style.backgroundImage = 'url(pencil.png)';
  edit.style.right = '30px';

  edit.onclick = function (event) {
    event.stopPropagation();
    const oldName = label.textContent;
    const code = getScript(oldName);
    const form = document.createElement('form');
    const inputElement = document.createElement('input');
    inputElement.value = oldName;
    label.textContent = '';
    button.appendChild(form);
    form.appendChild(inputElement);
    inputElement.focus();
    inputElement.setSelectionRange(0, oldName.length);

    function rename() {
      const input = inputElement.value;
      inputElement.blur();
      if (!input) return;
      const newName = uniqueName(input);
      label.textContent = newName;
      if (currentElement.textContent == oldName) {
        currentElement.textContent = newName;
      }
      removeScript(oldName);
      setScript(newName, code);
    }

    form.onsubmit = rename;
    inputElement.onclick = function (event) { event.stopPropagation(); };

    inputElement.onblur = function () {
      button.removeChild(form);
      label.textContent = oldName;
    };
  };

  const trash = addIcon(button);
  trash.style.backgroundImage = 'url(trash.png)';
  trash.style.right = '0px';
  let lastClick = 0;

  trash.onclick = function (event) {
    event.stopPropagation();
    if (button.classList.contains('blue')) {
      lastClick = performance.now();
      button.classList.remove('blue');
      button.classList.add('red');
      document.body.addEventListener('click', function () {
        button.classList.add('blue');
        button.classList.remove('red');
      }, { once: true });
    } else if (performance.now() - lastClick > 500) {
      removeScript(label.textContent);
      button.parentElement.removeChild(button);
      switchTo('Intro');
    }
  };
}

function newItem(code) {
  const name = uniqueName('New Script');
  setScript(name, code);
  const nextButton = appendDropdownItem(name);
  addEdit(nextButton);
  nextButton.click();
};

const newButton = document.querySelector('#new');
newButton.onclick = function () { newItem(''); };

// Editor ------------------------------------------------------------
let worker = undefined;
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.0/min/vs' } });
require(['vs/editor/editor.main'], async function () {
  const content = await fetch('bindings.d.ts').then(response => response.text());
  monaco.languages.typescript.typescriptDefaults.addExtraLib(content);
  editor = monaco.editor.create(document.getElementById('editor'), {
    language: 'typescript',
    automaticLayout: true
  });
  const w = await monaco.languages.typescript.getTypeScriptWorker();
  worker = await w(editor.getModel().uri);

  for (const [name] of examples) {
    appendDropdownItem(name);
  }

  let currentName = currentElement.textContent;
  let safe2Execute = false;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = nthKey(i);
    if (!key) continue;
    if (key === 'currentName') {
      currentName = getScript(key);
    } else if (key === 'safe') {
      safe2Execute = getScript(key) !== 'false';
    } else {
      const button = appendDropdownItem(key);
      addEdit(button);
    }
  }
  switchTo(currentName);

  if (safe2Execute) { document.querySelector('#compile').click(); }

  editor.onDidChangeModelContent(e => {
    runButton.disabled = false;
    if (switching) {
      switching = false;
      return;
    }
    if (isExample) {
      const cursor = editor.getPosition();
      newItem(editor.getValue());
      editor.setPosition(cursor);
    }
  });

  window.onresize = () => {
    editor.layout({});
  };
});

// Execution ------------------------------------------------------------
const runButton = document.querySelector('#compile');
const consoleElement = document.querySelector('#console');

const oldLog = console.log;
console.log = function (message) {
  consoleElement.textContent += message.toString() + '\r\n';
  consoleElement.scrollTop = consoleElement.scrollHeight;
  oldLog(message);
};

function clearConsole() {
  consoleElement.textContent = '';
}

var Module = {
  onRuntimeInitialized: function () {
    Module.setup();
    // Setup memory management, such that users don't have to care about
    // calling `delete` manually.
    // Note that this only fixes memory leak across different runs: the memory
    // will only be freed when the compilation finishes.

    // manifold member functions that returns a new manifold
    const memberFunctions = [
      'add', 'subtract', 'intersect', 'refine', 'transform', 'translate', 'rotate',
      'scale', 'asOriginal', 'smooth', 'decompose'
    ];
    // top level functions that constructs a new manifold
    const constructors = [
      'cube', 'cylinder', 'sphere', 'tetrahedron', 'extrude', 'revolve', 'union',
      'difference', 'intersection', 'compose', 'levelSet'
    ];
    const utils = [
      'setMinCircularAngle', 'setMinCircularEdgeLength', 'setCircularSegments',
      'getCircularSegments'
    ];
    const exposedFunctions = constructors.concat(utils);

    let manifoldRegistry = [];
    for (const name of memberFunctions) {
      const originalFn = Module.Manifold.prototype[name];
      Module.Manifold.prototype["_" + name] = originalFn;
      Module.Manifold.prototype[name] = function (...args) {
        const result = this["_" + name](...args);
        manifoldRegistry.push(result);
        return result;
      }
    }

    for (const name of constructors) {
      const originalFn = Module[name];
      Module[name] = function (...args) {
        const result = originalFn(...args);
        manifoldRegistry.push(result);
        return result;
      }
    }

    Module.cleanup = function () {
      for (const obj of manifoldRegistry) {
        // decompose result is an array of manifolds
        if (obj instanceof Array)
          for (const elem of obj)
            elem.delete();
        else
          obj.delete();
      }
      manifoldRegistry = [];
    }

    runButton.onclick = async function (e) {
      saveCurrent();
      setScript('safe', 'false');
      runButton.disabled = true;
      clearConsole();
      console.log('Running...');
      const output = await worker.getEmitOutput(editor.getModel().uri.toString());
      const content = output.outputFiles[0].text + 'push2MV(result);';
      try {
        const f = new Function(...exposedFunctions, content);
        const t0 = performance.now();
        f(...exposedFunctions.map(name => Module[name]));
        const t1 = performance.now();
        const log = consoleElement.textContent;
        // Remove "Running..."
        consoleElement.textContent = log.substring(log.indexOf("\n") + 1);
        console.log(`Took ${Math.round(t1 - t0)} ms`);
        setScript('safe', 'true');
      } catch (error) {
        console.log(error);
      } finally {
        Module.cleanup();
      }
    };
  }
};

// Export & Rendering ------------------------------------------------------------
const mv = document.querySelector('model-viewer');
const mesh = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({
  color: 'yellow',
  metalness: 1,
  roughness: 0.2
}));
const rotation = new THREE.Matrix4();
rotation.set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1);
mesh.setRotationFromMatrix(rotation); // Z-up -> Y-up
mesh.scale.setScalar(0.001); // mm -> m

let objectURL = null;
const exporter = new THREE.GLTFExporter();

function push2MV(manifold) {
  const box = manifold.boundingBox();
  const size = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    size[i] = Math.round((box.max[i] - box.min[i]) * 10) / 10;
  }
  console.log(`Bounding Box: X = ${size[0]} mm, Y = ${size[1]} mm, Z = ${size[2]} mm`);
  mesh.geometry?.dispose();
  mesh.geometry = mesh2geometry(manifold.getMesh());
  exporter.parse(
    mesh,
    (gltf) => {
      const blob = new Blob([gltf], { type: 'application/octet-stream' });
      URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(blob);
      mv.src = objectURL;
    },
    () => console.log('glTF export failed!'),
    { binary: true }
  );
}

function mesh2geometry(mesh) {
  const geometry = new THREE.BufferGeometry();

  const numVert = mesh.vertPos.size();
  const vert = new Float32Array(3 * numVert);
  for (let i = 0; i < numVert; i++) {
    const v = mesh.vertPos.get(i);
    const idx = 3 * i;
    vert[idx] = v.x;
    vert[idx + 1] = v.y;
    vert[idx + 2] = v.z;
  }

  const numTri = mesh.triVerts.size();
  const tri = new Uint32Array(3 * numTri);
  for (let i = 0; i < numTri; i++) {
    const v = mesh.triVerts.get(i);
    const idx = 3 * i;
    tri[idx] = v[0];
    tri[idx + 1] = v[1];
    tri[idx + 2] = v[2];
  }

  mesh.vertPos.delete();
  mesh.triVerts.delete();
  mesh.vertNormal.delete();
  mesh.halfedgeTangent.delete();

  geometry.setAttribute('position', new THREE.BufferAttribute(vert, 3));
  geometry.setIndex(new THREE.BufferAttribute(tri, 1));
  return geometry;
}

document.querySelector('#download').onclick = function () {
  const link = document.createElement("a");
  link.download = "manifold.glb";
  link.href = objectURL;
  link.click();
};