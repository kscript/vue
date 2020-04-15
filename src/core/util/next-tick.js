/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

function flushCallbacks () {
  pending = false
  const copies = callbacks.slice(0)
  callbacks.length = 0
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// 如果原生支持Promise
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  // 创建一个resolved的promise
  const p = Promise.resolve()
  timerFunc = () => {
    // 在这个resolved的promise后面紧跟的即是微任务
    // 在微任务里清理调用链
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    // isIOS时, 创建一个空的宏任务, 强制清空微任务队列
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
  // 非ie且原生支持MutationObserver的浏览器
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS无头浏览器 和 iOS 7.x 系列的浏览器
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  let counter = 1
  // 这里创建一个监视对DOM树所做更改observer, 当DOM树更改时即会创建微任务
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  // timerFunc 用于修改DOM树
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
  // 如果原生支持setImmediate, 那么nextTick则利用的是宏任务
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // 其它条件都不具备, 则使用setTimeout
  // 看到这里的分支, 接下来再回到nextTick(flushCallbacks就不看了, 没什么东西)
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}
// >7 nextTick
export function nextTick (cb?: Function, ctx?: Object) {
  let _resolve
  // 在调用链尾部中加入传入的任务
  // 里面push的函数, 会在调用flushCallbacks后被遍历执行
  callbacks.push(() => {
    // 有回调执行回调
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
    // 没回调如果_resolve有值, 说明要返回一个promise
  } else if (_resolve) {
      // 结束promise
      _resolve(ctx)
    }
  })
  // 如果不是在pending状态, 那么调用timerFunc函数
  // 当然, 如果是在pending状态, 那么意味着肯定是在执行timerFunc函数
  if (!pending) {
    pending = true
    // 触发 timerFunc, 创建一个微/宏任务, 准备清空调用链
    timerFunc()
  }
  // 如果没有传入回调, 且支持Promise, 则返回一个promise
  // 目的是在调用链执行完紧接着执行
  // $flow-disable-line
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
