// [[C130]] rustCore, [[D99]] rustIsSpec
//! The Formula.js dotless and legacy statistics names, rounding aliases and a few leftovers. The legacy names are
//! blocked on the formula surface (`LEGACY_ALIASES`): each body answers `#NAME?` naming its modern replacement.

use crate::error_value::sol_error;
use crate::excel_functions::V;

/// `LEGACY_ALIASES`: a blocked name and the function that replaces it.
const BLOCKED: &[(&str, &str)] = &[
    ("SUMIF", "SUMIFS"), ("SUBTOTAL", "SUM"), ("AGGREGATE", "SUM"),
    ("AVERAGEA", "AVERAGE"), ("MINA", "MIN"), ("MAXA", "MAX"), ("STDEVA", "STDEV.S"), ("STDEVPA", "STDEV.P"),
    ("VARA", "VAR.S"), ("VARPA", "VAR.P"),
    ("NORMDIST", "NORM.DIST"), ("NORMINV", "NORM.INV"), ("NORMSDIST", "NORM.S.DIST"), ("NORMSINV", "NORM.S.INV"),
    ("LOGNORMDIST", "LOGNORM.DIST"), ("LOGINV", "LOGNORM.INV"), ("LOGNORMINV", "LOGNORM.INV"),
    ("TDIST", "T.DIST.RT"), ("TINV", "T.INV.2T"), ("CHIDIST", "CHISQ.DIST.RT"), ("CHIINV", "CHISQ.INV.RT"),
    ("FDIST", "F.DIST.RT"), ("FINV", "F.INV.RT"), ("BETADIST", "BETA.DIST"), ("BETAINV", "BETA.INV"),
    ("GAMMADIST", "GAMMA.DIST"), ("GAMMAINV", "GAMMA.INV"), ("EXPONDIST", "EXPON.DIST"), ("WEIBULLDIST", "WEIBULL.DIST"),
    ("BINOMDIST", "BINOM.DIST"), ("NEGBINOMDIST", "NEGBINOM.DIST"), ("HYPGEOMDIST", "HYPGEOM.DIST"),
    ("POISSONDIST", "POISSON.DIST"), ("CRITBINOM", "BINOM.INV"),
    ("CHITEST", "CHISQ.TEST"), ("FTEST", "F.TEST"), ("TTEST", "T.TEST"), ("ZTEST", "Z.TEST"),
    ("FORECAST", "FORECAST.LINEAR"), ("NETWORKDAYSINTL", "NETWORKDAYS.INTL"), ("WORKDAYINTL", "WORKDAY.INTL"),
    ("CEILINGMATH", "CEILING.MATH"), ("CEILINGPRECISE", "CEILING.MATH"), ("FLOORMATH", "FLOOR.MATH"),
    ("FLOORPRECISE", "FLOOR.MATH"), ("CEILING.PRECISE", "CEILING.MATH"), ("FLOOR.PRECISE", "FLOOR.MATH"),
    ("ISO.CEILING", "CEILING.MATH"), ("ISO.CEILING.MATH", "CEILING.MATH"), ("ISO.CEILING.PRECISE", "CEILING.MATH"),
    ("GAMMALNPRECISE", "GAMMALN.PRECISE"), ("MODESNGL", "MODE.SNGL"),
    ("PERCENTILEINC", "PERCENTILE.INC"), ("PERCENTILEEXC", "PERCENTILE.EXC"),
    ("PERCENTRANKINC", "PERCENTRANK.INC"), ("PERCENTRANKEXC", "PERCENTRANK.EXC"),
    ("QUARTILEINC", "QUARTILE.INC"), ("QUARTILEEXC", "QUARTILE.EXC"), ("RANKEQ", "RANK.EQ"), ("RANKAVG", "RANK.AVG"),
    ("STDEVS", "STDEV.S"), ("STDEVP", "STDEV.P"), ("VARS", "VAR.S"), ("VARP", "VAR.P"),
    ("COVARIANCEP", "COVARIANCE.P"), ("COVARIANCES", "COVARIANCE.S"), ("SKEWP", "SKEW.P"),
    ("CHIDISTRT", "CHISQ.DIST.RT"), ("CHIINVRT", "CHISQ.INV.RT"), ("FDISTRT", "F.DIST.RT"), ("FINVRT", "F.INV.RT"),
    ("TDISTRT", "T.DIST.RT"), ("TDIST.RT", "T.DIST.RT"), ("TDIST.2T", "T.DIST.2T"), ("TINV.2T", "T.INV.2T"),
    ("CHIDIST.RT", "CHISQ.DIST.RT"), ("CHIINV.RT", "CHISQ.INV.RT"), ("FDIST.RT", "F.DIST.RT"), ("FINV.RT", "F.INV.RT"),
    ("BINOMDIST.RANGE", "BINOM.DIST.RANGE"),
];

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "SUMIF", "SUBTOTAL", "AGGREGATE", "AVERAGEA", "MINA", "MAXA", "STDEVA", "STDEVPA", "VARA", "VARPA",
    "NORMDIST", "NORMINV", "NORMSDIST", "NORMSINV", "LOGNORMDIST", "LOGINV", "LOGNORMINV", "TDIST", "TINV", "CHIDIST",
    "CHIINV", "FDIST", "FINV", "BETADIST", "BETAINV", "GAMMADIST", "GAMMAINV", "EXPONDIST", "WEIBULLDIST", "BINOMDIST",
    "NEGBINOMDIST", "HYPGEOMDIST", "POISSONDIST", "CRITBINOM", "CHITEST", "FTEST", "TTEST", "ZTEST", "FORECAST",
    "NETWORKDAYSINTL", "WORKDAYINTL", "CEILINGMATH", "CEILINGPRECISE", "FLOORMATH", "FLOORPRECISE", "CEILING.PRECISE",
    "FLOOR.PRECISE", "ISO.CEILING", "ISO.CEILING.MATH", "ISO.CEILING.PRECISE", "GAMMALNPRECISE", "MODESNGL",
    "PERCENTILEINC", "PERCENTILEEXC", "PERCENTRANKINC", "PERCENTRANKEXC", "QUARTILEINC", "QUARTILEEXC", "RANKEQ",
    "RANKAVG", "STDEVS", "STDEVP", "VARS", "VARP", "COVARIANCEP", "COVARIANCES", "SKEWP", "CHIDISTRT", "CHIINVRT",
    "FDISTRT", "FINVRT", "TDISTRT", "TDIST.RT", "TDIST.2T", "TINV.2T", "CHIDIST.RT", "CHIINV.RT", "FDIST.RT", "FINV.RT",
    "BINOMDIST.RANGE",
    "TRUE", "FALSE",
];

pub fn call(name: &str, _a: &[V]) -> V {
    if let Some((_, to)) = BLOCKED.iter().find(|(from, _)| *from == name) {
        return V::err(sol_error("#NAME?", format!("Use {to}")));
    }
    match name {
        "TRUE" => V::Bool(true),
        "FALSE" => V::Bool(false),
        _ => crate::excel_functions::bail(),
    }
}
