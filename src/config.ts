export const config = {
  owners: [
    "695228246966534255",
    "980280857958965328",
    "691321562179305492",
    "884036644234231819",
  ],
  testServers: ["907340495498407977"],
};

let _maintainanceMode = false;
let _reason: string;
export const maintainanceMode = {
  get: () => {
    return { on: _maintainanceMode, reason: _reason };
  },
  set: (on: boolean, reason?: string) => {
    _maintainanceMode = on;
    if (reason) _reason = reason;
    return maintainanceMode.get();
  },
};
