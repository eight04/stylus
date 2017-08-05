'use strict';

// eslint-disable-next-line no-var
var semver = {
  test(a, b) {
    a = a.split('.').map(Number);
    b = b.split('.').map(Number);

    for (let i = 0; i < a.length; i++) {
      if (!(i in b)) {
        return 1;
      }
      if (a[i] < b[i]) {
        return -1;
      }
      if (a[i] > b[i]) {
        return 1;
      }
    }

    if (a.length < b.length) {
      return -1;
    }

    return 0;
  }
};
