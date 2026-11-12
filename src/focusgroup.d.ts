// [[A1]] visualGraphCalculator, [[components#One design system governs every look, layout and word in the app]]
// Chrome 150's focusgroup attribute (declarative arrow-key navigation inside a composite widget), not yet in React's types.
import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    focusgroup?: string;
  }
}
