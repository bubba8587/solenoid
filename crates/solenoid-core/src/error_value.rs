// [[C130]] rustCore
//! Port of `src/graph/errorValue.ts` (the parts the frame verbs use).

use std::fmt;

/// A closed set of error codes, each spelled once; the spelling crosses the wire, the variant everything else.
macro_rules! codes {
    ($(#[$doc:meta])* $name:ident { $($code:ident = $spelled:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name {
            $($code),*
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$code),*];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$code => $spelled),*
                }
            }

            pub fn from_code(code: &str) -> Option<$name> {
                $name::ALL.iter().copied().find(|c| c.as_str() == code)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(self.as_str())
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<$name, D::Error> {
                let code = <std::borrow::Cow<'de, str>>::deserialize(d)?;
                $name::from_code(&code).ok_or_else(|| serde::de::Error::custom(format!("unknown error code {code}")))
            }
        }
    };
}

codes! {
    /// Solenoid's error codes (`SolErrorCode` in errorValue.ts).
    ErrorCode {
        DivZero = "#DIV/0!",
        NotAvailable = "#N/A",
        Domain = "#DOMAIN!",
        Conv = "#CONV!",
        Overflow = "#OVERFLOW!",
        Syntax = "#SYNTAX!",
        Value = "#VALUE!",
        Type = "#TYPE!",
        Shape = "#SHAPE!",
        Unit = "#UNIT!",
        Name = "#NAME?",
        Ref = "#REF!",
        Circ = "#CIRC!",
        Solve = "#SOLVE!",
        Ambiguous = "#AMBIGUOUS!",
        Error = "#ERROR!",
    }
}

codes! {
    /// A Formula.js `Error` by its message, which flows as a value until `normalizeFxResult` reads it as a SolError.
    FxError {
        Value = "#VALUE!",
        Ref = "#REF!",
        DivZero = "#DIV/0!",
        Num = "#NUM!",
        Name = "#NAME?",
        Null = "#NULL!",
        NotAvailable = "#N/A",
        Error = "#ERROR!",
    }
}

impl ErrorCode {
    /// A code read off the wire. The TS sends only its own codes; anything else reads as `#ERROR!`.
    pub fn from_wire(code: &str) -> ErrorCode {
        ErrorCode::from_code(code).unwrap_or(ErrorCode::Error)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SolError {
    pub code: ErrorCode,
    pub message: String,
    /// The JS side's reference to the uploaded original, handed back so it downloads as itself.
    pub reference: Option<u32>,
}

pub fn sol_error(code: ErrorCode, message: impl Into<String>) -> SolError {
    SolError { code, message: message.into(), reference: None }
}
