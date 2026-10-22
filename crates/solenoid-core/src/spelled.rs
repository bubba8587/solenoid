// [[C130]] rustCore
//! Closed sets of names that cross the wire as text: each variant is spelled once, and the text is read and written
//! only at the boundary (`FromStr`, `Display`, serde).

use std::str::FromStr;

/// A name outside the set it was read as.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unknown(pub String);

impl std::fmt::Display for Unknown {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown name \"{}\"", self.0)
    }
}

/// `enum Name { Variant = "spelling", … }`: a `Copy` enum with `ALL`, `as_str`, `FromStr`, `Display` and serde as
/// its spelling.
macro_rules! spelled {
    ($(#[$doc:meta])* $vis:vis enum $name:ident { $($(#[$vdoc:meta])* $variant:ident = $spelling:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        $vis enum $name {
            $($(#[$vdoc])* $variant),*
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),*];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $spelling),*
                }
            }
        }

        impl std::str::FromStr for $name {
            type Err = $crate::spelled::Unknown;

            fn from_str(s: &str) -> Result<$name, $crate::spelled::Unknown> {
                $name::ALL.iter().copied().find(|v| v.as_str() == s).ok_or_else(|| $crate::spelled::Unknown(s.to_string()))
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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
                let s = <std::borrow::Cow<'de, str>>::deserialize(d)?;
                s.parse().map_err(serde::de::Error::custom)
            }
        }
    };
}

pub(crate) use spelled;

/// A closed name as the wire carries it: one this core knows, or the text of one it doesn't, kept so the verb that
/// reads it refuses it in its own words and at its own step.
#[derive(Clone, Debug, PartialEq)]
pub enum Wire<T> {
    Known(T),
    Unknown(String),
}

impl<T: Copy> Wire<T> {
    /// The name, or the unknown text to refuse.
    pub fn known(&self) -> Result<T, &str> {
        match self {
            Wire::Known(v) => Ok(*v),
            Wire::Unknown(s) => Err(s),
        }
    }
}

impl<'de, T: FromStr> serde::Deserialize<'de> for Wire<T> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Wire<T>, D::Error> {
        let s = <std::borrow::Cow<'de, str>>::deserialize(d)?;
        Ok(s.parse().map_or_else(|_| Wire::Unknown(s.into_owned()), Wire::Known))
    }
}
